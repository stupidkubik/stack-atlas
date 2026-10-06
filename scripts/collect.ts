import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppEnvironment, EnvironmentSource, LiveEnvironment } from "../src/server/config/environment";
import { SafeConfigurationError } from "../src/server/config/environment";
import { selectComponentTarget } from "../src/server/config/targets";
import { createDirectMetricsWriterSession } from "../src/server/db/connections";
import { replaceMetricsForProduct } from "../src/server/db/metrics-repository";
import { releaseCollectorLock, tryAcquireCollectorLock } from "../src/server/db/collector-lock";
import type { MappingIdentity } from "../src/domain/data-contracts";
import { productId } from "../src/domain/ids";
import { runMetricsCollector, type CollectorMode, type MetricsCollectorDependencies } from "../src/server/collector/metrics";
import { invalidateMetricsProducts } from "../src/server/collector/invalidation-client";
import { collectGitHubMetrics } from "../src/server/sources/github";
import { collectNpmDownloads, npmRangeInternals } from "../src/server/sources/npm";
import { fixtureSnapshot } from "../src/server/fixtures/catalog";
import { syntheticGitHubRepositoryResponse } from "../src/server/fixtures/api-responses";

export interface CollectCliArgs {
  readonly environment: AppEnvironment;
  readonly mode: CollectorMode;
  readonly allowProduction: boolean;
  readonly reportPath?: string;
}

export class SafeCollectorCliError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "SafeCollectorCliError";
    this.code = code;
  }
}

export function parseCollectCliArgs(argv: readonly string[]): CollectCliArgs {
  let environment: AppEnvironment | undefined;
  let mode: CollectorMode | undefined;
  let allowProduction = false;
  let reportPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--env") {
      if (environment || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new SafeCollectorCliError("collect_cli_invalid_arguments");
      const candidate = argv[++index];
      if (!["fixture", "development", "production"].includes(candidate)) throw new SafeCollectorCliError("collect_cli_invalid_arguments");
      environment = candidate as AppEnvironment;
    } else if (argument === "--dry-run" || argument === "--apply") {
      if (mode) throw new SafeCollectorCliError("collect_cli_invalid_arguments");
      mode = argument === "--dry-run" ? "dry-run" : "apply";
    } else if (argument === "--allow-production") {
      if (allowProduction) throw new SafeCollectorCliError("collect_cli_invalid_arguments");
      allowProduction = true;
    } else if (argument === "--report-path") {
      if (reportPath || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new SafeCollectorCliError("collect_cli_invalid_arguments");
      reportPath = argv[++index];
    } else {
      throw new SafeCollectorCliError("collect_cli_invalid_arguments");
    }
  }
  if (!environment || !mode || (allowProduction && environment !== "production") || (environment === "fixture" && mode === "apply")) {
    throw new SafeCollectorCliError("collect_cli_invalid_arguments");
  }
  if (mode === "apply" && environment === "production" && !allowProduction) {
    throw new SafeCollectorCliError("collect_production_guard_required");
  }
  return { environment, mode, allowProduction, ...(reportPath ? { reportPath } : {}) };
}

function loadLocalEnvironment(): void {
  try {
    const require = createRequire(import.meta.url);
    const { loadEnvConfig } = require("@next/env") as { loadEnvConfig: (directory: string, dev: boolean, logger?: { info(): void; error(): void }) => unknown };
    loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  } catch {
    throw new SafeCollectorCliError("collect_environment_load_failed");
  }
}

function commandEnvironment(args: CollectCliArgs, source: EnvironmentSource): EnvironmentSource {
  if (source.APP_ENV?.trim() && source.APP_ENV.trim() !== args.environment) throw new SafeCollectorCliError("collect_environment_mismatch");
  if (
    source.GITHUB_EVENT_NAME === "pull_request" || source.PKGCOMPASS_UNTRUSTED_PR === "true" ||
    (source.VERCEL_GIT_PULL_REQUEST_ID && source.PKGCOMPASS_TRUSTED_PREVIEW !== "true")
  ) throw new SafeCollectorCliError("collect_untrusted_context");
  if (
    (source.VERCEL_ENV === "production" && args.environment !== "production") ||
    (source.VERCEL_ENV === "development" && args.environment !== "development") ||
    (source.VERCEL_ENV === "preview" && (args.environment !== "development" || source.PKGCOMPASS_TRUSTED_PREVIEW !== "true"))
  ) throw new SafeCollectorCliError("collect_environment_mismatch");
  return { ...source, APP_ENV: args.environment };
}

function fixtureMappings(): readonly MappingIdentity[] {
  return fixtureSnapshot.products.filter(({ state }) => state === "published").map((product) => {
    const primaryPackage = product.primaryPackageId
      ? fixtureSnapshot.packages.find(({ id }) => id === product.primaryPackageId)
      : undefined;
    const primaryRepository = product.primaryRepositoryId
      ? fixtureSnapshot.repositories.find(({ id }) => id === product.primaryRepositoryId)
      : undefined;
    return {
      productId: product.id,
      primaryPackage: primaryPackage ? { id: primaryPackage.id, packageName: primaryPackage.packageName } : null,
      primaryRepository: primaryRepository ? { id: primaryRepository.id, owner: primaryRepository.owner, name: primaryRepository.name } : null,
    };
  });
}

function fixtureDependencies(now: Date): MetricsCollectorDependencies {
  const mappings = fixtureMappings();
  return {
    readPublishedMappings: async (ids) => ids ? mappings.filter(({ productId: id }) => ids.includes(id)) : mappings,
    collectNpm: async (mapping, fetchedAt) => {
      if (!mapping.primaryPackage) return undefined;
      const period = npmRangeInternals.recentCompletedWindow(fetchedAt);
      return collectNpmDownloads({
        mapping,
        now: fetchedAt,
        request: async () => ({
          package: mapping.primaryPackage!.packageName,
          ...period,
          downloads: Array.from({ length: 30 }, (_, offset) => ({
            day: new Date(Date.parse(`${period.start}T00:00:00.000Z`) + offset * 24 * 60 * 60_000).toISOString().slice(0, 10),
            downloads: offset % 7,
          })),
        }),
      });
    },
    collectGitHub: async (mapping, fetchedAt) => {
      if (!mapping.primaryRepository) return [];
      const identity = `${mapping.primaryRepository.owner}/${mapping.primaryRepository.name}`;
      return collectGitHubMetrics({
        mapping,
        now: fetchedAt,
        request: async () => ({ ...syntheticGitHubRepositoryResponse, full_name: identity, html_url: `https://github.com/${identity}` }),
      });
    },
    now: () => now,
  };
}

async function liveDependencies(source: EnvironmentSource): Promise<{
  readonly dependencies: MetricsCollectorDependencies;
  readonly close: () => Promise<void>;
}> {
  const { readPublishedMappings } = await import("../src/server/sanity/published-mapping");
  const session = createDirectMetricsWriterSession(source);
  try {
    await session.connect();
  } catch {
    await session.close().catch(() => {});
    throw new SafeCollectorCliError("collect_database_unavailable");
  }

  const environment = source.APP_ENV as LiveEnvironment;
  const dependencies: MetricsCollectorDependencies = {
    readPublishedMappings: async (ids) => {
      const result = await readPublishedMappings(ids, source);
      if (!result.ok) throw new SafeCollectorCliError(result.code === "invalid_response" ? "collect_mapping_invalid" : "collect_cms_unavailable");
      return result.value.map(({ productId: id, primaryPackage, primaryRepository }) => ({
        productId: productId(id),
        primaryPackage: primaryPackage ? { id: primaryPackage.id, packageName: primaryPackage.packageName } : null,
        primaryRepository: primaryRepository ? { id: primaryRepository.id, owner: primaryRepository.owner, name: primaryRepository.name } : null,
      }));
    },
    collectNpm: (mapping, now) => collectNpmDownloads({ mapping, now }),
    collectGitHub: async (mapping, now) => collectGitHubMetrics({ mapping, now, token: source.GITHUB_API_TOKEN }),
    acquireLock: () => tryAcquireCollectorLock(session.client, environment),
    releaseLock: () => releaseCollectorLock(session.client, environment),
    writeProduct: async (id, observations, runId, now) => {
      const result = await replaceMetricsForProduct({ db: session.db, now, runId }, id, observations);
      return result.written;
    },
    invalidate: (env, ids) => invalidateMetricsProducts({ environment: env as LiveEnvironment, productIds: ids, source }),
  };
  return { dependencies, close: () => session.close() };
}

async function writeReport(path: string, report: unknown): Promise<void> {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !isAbsolute(runnerTemp)) throw new SafeCollectorCliError("collect_report_path_invalid");
  const root = resolve(runnerTemp);
  const destination = resolve(path);
  const relativePath = relative(root, destination);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
    throw new SafeCollectorCliError("collect_report_path_invalid");
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(report)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

export async function runCollectCli(argv = process.argv.slice(2), source: EnvironmentSource = process.env) {
  const args = parseCollectCliArgs(argv);
  const sourceWasInjected = source !== process.env;
  if (!sourceWasInjected) loadLocalEnvironment();
  const commandSource = sourceWasInjected ? { ...process.env, ...source } : process.env;
  const environmentSource = commandEnvironment(args, commandSource);
  if (args.environment !== "fixture") {
    selectComponentTarget("metricsWriter", environmentSource);
    selectComponentTarget("content", environmentSource);
  }

  let close: (() => Promise<void>) | undefined;
  try {
    const dependencies = args.environment === "fixture"
      ? fixtureDependencies(new Date())
      : await liveDependencies(environmentSource);
    if ("close" in dependencies) {
      close = dependencies.close;
    }
    const runnerDependencies = "dependencies" in dependencies ? dependencies.dependencies : dependencies;
    const report = await runMetricsCollector({
      environment: args.environment,
      mode: args.mode,
      allowProduction: args.allowProduction,
      dependencies: runnerDependencies,
    });
    if (args.reportPath) await writeReport(args.reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  } finally {
    await close?.().catch(() => {});
  }
}

export function isDirectCollectExecution(metaUrl = import.meta.url): boolean {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

if (isDirectCollectExecution()) {
  runCollectCli().then((report) => {
    process.exitCode = report.exitCode;
  }).catch((error: unknown) => {
    const code = error instanceof SafeCollectorCliError || error instanceof SafeConfigurationError
      ? error.code
      : "collect_failed";
    process.stderr.write(`Metrics collection failed (${code}).\n`);
    process.exitCode = 1;
  });
}
