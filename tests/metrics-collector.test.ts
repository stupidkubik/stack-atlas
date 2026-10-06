import { describe, expect, it } from "vitest";
import { packageId, productId, repositoryId } from "../src/domain/ids";
import type { MappingIdentity, MetricObservation } from "../src/domain/data-contracts";
import { runMetricsCollector } from "../src/server/collector/metrics";
import { utcDateTime } from "../src/domain/utc";

const now = new Date("2026-10-06T08:00:00.000Z");
const mapping: MappingIdentity = {
  productId: productId("prd_collector_test"),
  primaryPackage: { id: packageId("pkg_collector_test"), packageName: "@scope/sdk" },
  primaryRepository: { id: repositoryId("repo_collector_test"), owner: "vendor", name: "sdk" },
};

const unknownMetric: MetricObservation = {
  productId: mapping.productId,
  source: "github",
  metric: "license",
  sourceEntityId: mapping.primaryRepository!.id,
  sourceIdentity: "vendor/sdk",
  sourceUrl: "https://github.com/vendor/sdk",
  status: "unknown",
  reason: "license_not_detected",
  value: null,
  observedAt: null,
  fetchedAt: utcDateTime(now.toISOString()),
  periodStart: null,
  periodEnd: null,
  dailySeries: null,
};

describe("metrics collector orchestration", () => {
  it("dry-runs the full mapping recheck without lock, writes, or cache invalidation", async () => {
    let writeCalls = 0;
    let lockCalls = 0;
    let invalidationCalls = 0;
    let mappingReads = 0;
    const report = await runMetricsCollector({
      environment: "development",
      mode: "dry-run",
      dependencies: {
        now: () => now,
        readPublishedMappings: async () => { mappingReads += 1; return [mapping]; },
        collectNpm: async () => undefined,
        collectGitHub: async () => [unknownMetric],
        acquireLock: async () => { lockCalls += 1; return true; },
        releaseLock: async () => {},
        writeProduct: async () => { writeCalls += 1; return 1; },
        invalidate: async () => { invalidationCalls += 1; },
      },
    });

    expect(report).toMatchObject({ status: "succeeded", exitCode: 0, mode: "dry-run", products: [{ status: "collected", unknownMetrics: 1, written: 0 }] });
    expect(mappingReads).toBe(2);
    expect(lockCalls).toBe(0);
    expect(writeCalls).toBe(0);
    expect(invalidationCalls).toBe(0);
  });

  it("does not write when the environment lock is already held", async () => {
    let writeCalls = 0;
    let releaseCalls = 0;
    const report = await runMetricsCollector({
      environment: "development",
      mode: "apply",
      dependencies: {
        now: () => now,
        readPublishedMappings: async () => [mapping],
        acquireLock: async () => false,
        releaseLock: async () => { releaseCalls += 1; },
        writeProduct: async () => { writeCalls += 1; return 1; },
      },
    });

    expect(report).toMatchObject({ status: "failed", exitCode: 1, products: [] });
    expect(writeCalls).toBe(0);
    expect(releaseCalls).toBe(0);
  });

  it("skips a product whose published source identity changes before write", async () => {
    let mappingReads = 0;
    let writeCalls = 0;
    const moved: MappingIdentity = {
      ...mapping,
      primaryPackage: { ...mapping.primaryPackage!, packageName: "@scope/new-sdk" },
    };
    const report = await runMetricsCollector({
      environment: "development",
      mode: "apply",
      dependencies: {
        now: () => now,
        readPublishedMappings: async () => {
          mappingReads += 1;
          return mappingReads === 1 ? [mapping] : [moved];
        },
        collectNpm: async () => undefined,
        collectGitHub: async () => [unknownMetric],
        acquireLock: async () => true,
        releaseLock: async () => {},
        writeProduct: async () => { writeCalls += 1; return 1; },
      },
    });

    expect(report.products).toMatchObject([{ status: "skipped", reason: "mapping_changed", written: 0 }]);
    expect(writeCalls).toBe(0);
  });

  it("requires explicit production authorization for apply mode", async () => {
    await expect(runMetricsCollector({
      environment: "production",
      mode: "apply",
      dependencies: { readPublishedMappings: async () => [] },
    })).rejects.toThrow("production_apply_guard_required");
  });
});
