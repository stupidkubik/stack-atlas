import { randomUUID } from "node:crypto";
import type { AppEnvironment } from "../config/environment";
import { parseMappingIdentity, type MappingIdentity, type MetricObservation } from "../../domain/data-contracts";
import type { ProductId } from "../../domain/ids";
import { collectGitHubMetrics } from "../sources/github";
import { collectNpmDownloads } from "../sources/npm";

export type CollectorMode = "dry-run" | "apply";
export type CollectorReportStatus = "succeeded" | "partial" | "failed";

export interface CollectorProductReport {
  readonly productId: ProductId;
  readonly status: "collected" | "skipped" | "failed";
  readonly reason: string | null;
  readonly observedMetrics: number;
  readonly errorMetrics: number;
  readonly unknownMetrics: number;
  readonly written: number;
}

export interface MetricsCollectorReport {
  readonly runId: string;
  readonly environment: AppEnvironment;
  readonly mode: CollectorMode;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status: CollectorReportStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly cacheInvalidation: "not_needed" | "succeeded" | "failed";
  readonly products: readonly CollectorProductReport[];
}

export interface MetricsCollectorDependencies {
  readonly readPublishedMappings: (productIds?: readonly ProductId[]) => Promise<readonly MappingIdentity[]>;
  readonly collectNpm?: (mapping: MappingIdentity, now: Date) => Promise<MetricObservation | undefined>;
  readonly collectGitHub?: (mapping: MappingIdentity, now: Date) => Promise<readonly MetricObservation[]>;
  readonly acquireLock?: () => Promise<boolean>;
  readonly releaseLock?: () => Promise<void>;
  readonly writeProduct?: (productId: ProductId, observations: readonly MetricObservation[], runId: string, now: Date) => Promise<number>;
  readonly invalidate?: (environment: AppEnvironment, productIds: readonly ProductId[]) => Promise<void>;
  readonly now?: () => Date;
}

function metricMappingFingerprint(mapping: MappingIdentity): string {
  return JSON.stringify({
    packageId: mapping.primaryPackage?.id ?? null,
    packageName: mapping.primaryPackage?.packageName ?? null,
    productId: mapping.productId,
    repositoryId: mapping.primaryRepository?.id ?? null,
    repositoryName: mapping.primaryRepository?.name ?? null,
    repositoryOwner: mapping.primaryRepository?.owner ?? null,
  });
}

function normalizeMappings(inputs: readonly unknown[]): readonly MappingIdentity[] {
  const mappings = inputs.map(parseMappingIdentity);
  if (mappings.some((mapping) => !mapping)) throw new Error("published_mapping_invalid");
  const records = mappings as MappingIdentity[];
  if (new Set(records.map((mapping) => mapping.productId)).size !== records.length) {
    throw new Error("published_mapping_duplicate_product");
  }
  return records;
}

function stamp(now: Date): string {
  return now.toISOString();
}

export async function runMetricsCollector(input: {
  readonly environment: AppEnvironment;
  readonly mode: CollectorMode;
  readonly allowProduction?: boolean;
  readonly dependencies: MetricsCollectorDependencies;
}): Promise<MetricsCollectorReport> {
  if (input.mode === "apply" && input.environment === "production" && !input.allowProduction) {
    throw new Error("production_apply_guard_required");
  }
  if (input.mode === "apply" && input.environment === "fixture") {
    throw new Error("fixture_apply_disabled");
  }
  const { dependencies } = input;
  const start = dependencies.now?.() ?? new Date();
  const runId = randomUUID();
  const products: CollectorProductReport[] = [];
  let cacheInvalidation: MetricsCollectorReport["cacheInvalidation"] = "not_needed";
  let status: CollectorReportStatus = "succeeded";
  let locked = false;

  try {
    if (input.mode === "apply") {
      if (!dependencies.acquireLock || !dependencies.releaseLock || !dependencies.writeProduct || !dependencies.invalidate) {
        throw new Error("collector_write_dependencies_missing");
      }
      locked = await dependencies.acquireLock();
      if (!locked) {
        const finished = dependencies.now?.() ?? new Date();
        return {
          runId,
          environment: input.environment,
          mode: input.mode,
          startedAt: stamp(start),
          finishedAt: stamp(finished),
          durationMs: Math.max(0, finished.getTime() - start.getTime()),
          status: "failed",
          exitCode: 1,
          cacheInvalidation: "not_needed",
          products: [],
        };
      }
    }

    const initialMappings = normalizeMappings(await dependencies.readPublishedMappings());
    const initialById = new Map(initialMappings.map((mapping) => [mapping.productId, mapping] as const));
    const changedProductIds: ProductId[] = [];
    for (const mapping of initialMappings) {
      const now = dependencies.now?.() ?? new Date();
      const [npm, github] = await Promise.all([
        dependencies.collectNpm
          ? dependencies.collectNpm(mapping, now)
          : collectNpmDownloads({ mapping, now }),
        dependencies.collectGitHub
          ? dependencies.collectGitHub(mapping, now)
          : collectGitHubMetrics({ mapping, now }),
      ]);
      const observations = [...(npm ? [npm] : []), ...github];
      let currentMappings: readonly MappingIdentity[];
      try {
        currentMappings = normalizeMappings(await dependencies.readPublishedMappings([mapping.productId]));
      } catch {
        products.push({
          productId: mapping.productId,
          status: "skipped",
          reason: "mapping_recheck_failed",
          observedMetrics: observations.filter((item) => item.status === "ok").length,
          errorMetrics: observations.filter((item) => item.status === "error").length,
          unknownMetrics: observations.filter((item) => item.status === "unknown").length,
          written: 0,
        });
        status = "partial";
        continue;
      }
      const current = currentMappings.find((item) => item.productId === mapping.productId);
      if (!current || metricMappingFingerprint(current) !== metricMappingFingerprint(mapping)) {
        products.push({
          productId: mapping.productId,
          status: "skipped",
          reason: "mapping_changed",
          observedMetrics: observations.filter((item) => item.status === "ok").length,
          errorMetrics: observations.filter((item) => item.status === "error").length,
          unknownMetrics: observations.filter((item) => item.status === "unknown").length,
          written: 0,
        });
        continue;
      }
      if (!initialById.has(mapping.productId)) continue;

      let written = 0;
      if (input.mode === "apply" && observations.length) {
        try {
          written = await dependencies.writeProduct!(mapping.productId, observations, runId, now);
          changedProductIds.push(mapping.productId);
        } catch {
          products.push({
            productId: mapping.productId,
            status: "failed",
            reason: "metrics_write_failed",
            observedMetrics: observations.filter((item) => item.status === "ok").length,
            errorMetrics: observations.filter((item) => item.status === "error").length,
            unknownMetrics: observations.filter((item) => item.status === "unknown").length,
            written: 0,
          });
          status = "partial";
          continue;
        }
      }
      const errors = observations.filter((item) => item.status === "error").length;
      products.push({
        productId: mapping.productId,
        status: "collected",
        reason: errors ? "source_error" : null,
        observedMetrics: observations.filter((item) => item.status === "ok").length,
        errorMetrics: errors,
        unknownMetrics: observations.filter((item) => item.status === "unknown").length,
        written,
      });
      if (errors) status = "partial";
    }

    if (input.mode === "apply" && changedProductIds.length) {
      try {
        await dependencies.invalidate!(input.environment, changedProductIds);
        cacheInvalidation = "succeeded";
      } catch {
        cacheInvalidation = "failed";
        status = "partial";
      }
    }
  } catch {
    status = "failed";
  } finally {
    if (locked) {
      try {
        await dependencies.releaseLock?.();
      } catch {
        status = "partial";
      }
    }
  }

  const finished = dependencies.now?.() ?? new Date();
  const exitCode = status === "succeeded" ? 0 : status === "partial" ? 2 : 1;
  return {
    runId,
    environment: input.environment,
    mode: input.mode,
    startedAt: stamp(start),
    finishedAt: stamp(finished),
    durationMs: Math.max(0, finished.getTime() - start.getTime()),
    status,
    exitCode,
    cacheInvalidation,
    products,
  };
}
