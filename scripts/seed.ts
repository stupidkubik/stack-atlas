import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@sanity/client";
import type { AppEnvironment, EnvironmentSource } from "../src/server/config/environment";
import { SafeConfigurationError } from "../src/server/config/environment";
import { selectComponentTarget } from "../src/server/config/targets";
import { buildDevelopmentSeedDocuments, type SeedDocument } from "../src/domain/seed-records";
import { planSeedDocuments, type ExistingSeedIdentity, type SeedPlanRow } from "../src/server/sanity/seed-writer";

export interface SeedCliArgs {
  readonly environment: AppEnvironment;
  readonly mode: "dry-run" | "apply";
  readonly reportPath: string;
}

export class SafeSeedCliError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "SafeSeedCliError"; this.code = code; }
}

function safeSanityFailureCode(error: unknown): string {
  if (error === null || typeof error !== "object") return "sanity_request_failed";
  const value = error as Record<string, unknown>;
  const response = value.response !== null && typeof value.response === "object" ? value.response as Record<string, unknown> : undefined;
  const status = [value.statusCode, value.status, response?.statusCode, response?.status]
    .find((candidate) => typeof candidate === "number" && Number.isInteger(candidate));
  if (typeof status === "number" && status >= 400 && status < 600) return `sanity_http_${status}`;
  if (value.name === "AbortError") return "sanity_timeout";
  if (value.name === "TypeError") return "sanity_network_error";
  return "sanity_request_failed";
}

export function parseSeedCliArgs(argv: readonly string[]): SeedCliArgs {
  let environment: AppEnvironment | undefined;
  let mode: "dry-run" | "apply" | undefined;
  let reportPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--env") {
      if (environment || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new SafeSeedCliError("seed_cli_invalid_arguments");
      const candidate = argv[++index];
      if (!["fixture", "development", "production"].includes(candidate)) throw new SafeSeedCliError("seed_cli_invalid_arguments");
      environment = candidate as AppEnvironment;
    } else if (argument === "--dry-run" || argument === "--apply") {
      if (mode) throw new SafeSeedCliError("seed_cli_invalid_arguments");
      mode = argument === "--dry-run" ? "dry-run" : "apply";
    } else if (argument === "--report-path") {
      if (reportPath || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new SafeSeedCliError("seed_cli_invalid_arguments");
      reportPath = argv[++index];
    } else {
      throw new SafeSeedCliError("seed_cli_invalid_arguments");
    }
  }
  if (!environment || !mode || !reportPath || (environment === "fixture" && mode === "apply") || environment === "production") {
    throw new SafeSeedCliError("seed_cli_invalid_arguments");
  }
  return { environment, mode, reportPath };
}

function loadLocalEnvironment(): void {
  try {
    const require = createRequire(import.meta.url);
    const { loadEnvConfig } = require("@next/env") as { loadEnvConfig: (directory: string, dev: boolean, logger?: { info(): void; error(): void }) => unknown };
    loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  } catch {
    throw new SafeSeedCliError("seed_environment_load_failed");
  }
}

function ensureLocalDevelopment(args: SeedCliArgs, source: EnvironmentSource): EnvironmentSource {
  const hasCi = source.CI === "true" || source.CI === "1";
  const untrusted = source.GITHUB_EVENT_NAME === "pull_request" || source.PKGCOMPASS_UNTRUSTED_PR === "true" ||
    Boolean(source.VERCEL_GIT_PULL_REQUEST_ID?.trim()) || hasCi || Boolean(source.VERCEL || source.VERCEL_ENV);
  if (untrusted) throw new SafeSeedCliError("seed_untrusted_context");
  if (source.APP_ENV?.trim() && source.APP_ENV.trim() !== args.environment) throw new SafeSeedCliError("seed_environment_mismatch");
  if (args.mode === "apply" && args.environment !== "development") throw new SafeSeedCliError("seed_development_only");
  return { ...source, APP_ENV: args.environment };
}

function ensureStudioTarget(source: EnvironmentSource, projectId: string, dataset: string): void {
  if (source.SANITY_STUDIO_PROJECT_ID !== projectId || source.SANITY_STUDIO_DATASET !== dataset) {
    throw new SafeSeedCliError("seed_studio_target_mismatch");
  }
}

function existingQueryCandidates(documents: readonly SeedDocument[]) {
  const ids = documents.flatMap(({ _id }) => [_id, `drafts.${_id}`]);
  const routeSlugs = documents.flatMap((doc) => {
    const routeSlug = doc.routeSlug;
    return routeSlug && typeof routeSlug === "object" && "current" in routeSlug && typeof routeSlug.current === "string" ? [routeSlug.current] : [];
  });
  const packageNames = documents.flatMap((doc) => typeof doc.packageName === "string" ? [doc.packageName] : []);
  const pairKeys = documents.flatMap((doc) => typeof doc.pairKey === "string" ? [doc.pairKey] : []);
  return { ids, routeSlugs, packageNames, pairKeys };
}

const EXISTING_IDENTITIES_QUERY = `*[
  _id in $ids ||
  (_type in ["product", "category"] && routeSlug.current in $routeSlugs) ||
  (_type == "package" && packageName in $packageNames) ||
  (_type == "comparison" && pairKey in $pairKeys)
]{_id,_type,"slug":routeSlug.current,packageName,pairKey,"productId":productId._ref,owner,name}`;

function projectExistingIdentities(value: unknown): readonly ExistingSeedIdentity[] {
  if (!Array.isArray(value) || value.some((candidate) => candidate === null || typeof candidate !== "object" || Array.isArray(candidate))) throw new SafeSeedCliError("seed_preflight_invalid_response");
  return value.map((candidate) => {
    const item = candidate as Record<string, unknown>;
    if (typeof item._id !== "string" || typeof item._type !== "string" ||
      (item.slug !== undefined && item.slug !== null && typeof item.slug !== "string") ||
      (item.packageName !== undefined && item.packageName !== null && typeof item.packageName !== "string") ||
      (item.pairKey !== undefined && item.pairKey !== null && typeof item.pairKey !== "string") ||
      (item.productId !== undefined && item.productId !== null && typeof item.productId !== "string") ||
      (item.owner !== undefined && item.owner !== null && typeof item.owner !== "string") ||
      (item.name !== undefined && item.name !== null && typeof item.name !== "string")) throw new SafeSeedCliError("seed_preflight_invalid_response");
    return {
      id: item._id,
      type: item._type,
      ...(typeof item.slug === "string" ? { slug: item.slug } : {}),
      ...(typeof item.packageName === "string" ? { packageName: item.packageName } : {}),
      ...(typeof item.pairKey === "string" ? { pairKey: item.pairKey } : {}),
      ...(typeof item.productId === "string" ? { productId: item.productId } : {}),
      ...(typeof item.owner === "string" ? { owner: item.owner } : {}),
      ...(typeof item.name === "string" ? { name: item.name } : {}),
    };
  });
}

function reportFor(input: { readonly environment: AppEnvironment; readonly mode: "dry-run" | "apply"; readonly rows: readonly SeedPlanRow[]; readonly failed?: number }) {
  const count = (operation: SeedPlanRow["operation"]) => input.rows.filter((row) => row.operation === operation).length;
  return {
    environment: input.environment,
    mode: input.mode,
    syntheticDraftsOnly: true,
    documents: input.rows,
    summary: { create: count("create"), skip: count("skip"), conflict: count("conflict"), writeFailures: input.failed ?? 0 },
  };
}

async function writeSafeReport(path: string, report: unknown): Promise<void> {
  const root = resolve(process.cwd(), "artifacts", "runs");
  const destination = resolve(path);
  const relativePath = relative(root, destination);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath) || !relativePath.endsWith(".json")) {
    throw new SafeSeedCliError("seed_report_path_invalid");
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(report)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

export async function runSeedCli(argv = process.argv.slice(2), source: EnvironmentSource = process.env) {
  const args = parseSeedCliArgs(argv);
  const sourceWasInjected = source !== process.env;
  if (!sourceWasInjected) loadLocalEnvironment();
  const commandSource = sourceWasInjected ? { ...process.env, ...source } : process.env;
  const environmentSource = ensureLocalDevelopment(args, commandSource);
  const documents = await buildDevelopmentSeedDocuments();
  const content = selectComponentTarget("content", environmentSource);
  if (content.mode === "fixture") {
    const report = reportFor({ environment: args.environment, mode: args.mode, rows: planSeedDocuments({ documents, existing: [] }) });
    await writeSafeReport(args.reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  }

  if (args.environment !== "development") throw new SafeSeedCliError("seed_development_only");
  selectComponentTarget("metricsWriter", environmentSource);
  const writerTarget = selectComponentTarget("seed", environmentSource);
  if (writerTarget.mode !== "live") throw new SafeSeedCliError("seed_target_unavailable");
  ensureStudioTarget(environmentSource, content.settings.SANITY_PROJECT_ID, content.settings.SANITY_DATASET);
  const client = createClient({
    projectId: content.settings.SANITY_PROJECT_ID,
    dataset: content.settings.SANITY_DATASET,
    apiVersion: content.settings.SANITY_API_VERSION,
    token: writerTarget.settings.SANITY_SEED_WRITE_TOKEN,
    useCdn: false,
  });
  const readClient = client.withConfig({ perspective: "raw" });
  const candidates = existingQueryCandidates(documents);
  let existingRaw: unknown;
  try {
    existingRaw = await readClient.fetch<unknown>(EXISTING_IDENTITIES_QUERY, candidates, { timeout: 10_000 });
  } catch (error) {
    throw new SafeSeedCliError(safeSanityFailureCode(error));
  }
  const existing = projectExistingIdentities(existingRaw);
  const plan = planSeedDocuments({ documents, existing });
  let rows = plan;
  let failed = 0;
  if (args.mode === "apply") {
    const createIds = new Set(plan.filter((row) => row.operation === "create").map((row) => row.id));
    const createDocuments = documents.filter((document) => createIds.has(document._id));
    if (createDocuments.length > 0) {
      try {
        let transaction = client.transaction();
        for (const document of createDocuments) transaction = transaction.createIfNotExists({ ...document, _id: `drafts.${document._id}` });
        await transaction.commit();
      } catch (error) {
        failed = createDocuments.length;
        rows = plan.map((row) => row.operation === "create"
          ? { id: row.id, type: row.type, operation: "conflict", reason: "write_failed" as const }
          : row);
        // Keep diagnostics coarse. Sanity error messages may include request/body details.
        process.stderr.write(`Sanity seed transaction failed (${safeSanityFailureCode(error)}).\n`);
      }
    }
  }
  const report = reportFor({ environment: args.environment, mode: args.mode, rows, failed });
  await writeSafeReport(args.reportPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report;
}

export function isDirectSeedExecution(metaUrl = import.meta.url): boolean {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

if (isDirectSeedExecution()) {
  runSeedCli().catch((error: unknown) => {
    const code = error instanceof SafeSeedCliError || error instanceof SafeConfigurationError ? error.code : "seed_failed";
    process.stderr.write(`Sanity seed failed (${code}).\n`);
    process.exitCode = 1;
  });
}
