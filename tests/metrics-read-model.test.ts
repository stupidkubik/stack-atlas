import { describe, expect, it } from "vitest";
import { buildMetricsReadModel } from "../src/domain/metrics-read-model";
import { packageId, productId, repositoryId } from "../src/domain/ids";
import type { MappingIdentity, MetricsCurrentRow } from "../src/domain/data-contracts";
import { utcDateTime } from "../src/domain/utc";

const now = new Date("2026-10-06T08:00:00.000Z");
const mapping: MappingIdentity = {
  productId: productId("prd_read_model"),
  primaryPackage: { id: packageId("pkg_read_model"), packageName: "@scope/sdk" },
  primaryRepository: { id: repositoryId("repo_read_model"), owner: "vendor", name: "sdk" },
};

function npmSeries() {
  return Array.from({ length: 30 }, (_, offset) => ({
    day: new Date(Date.parse("2026-08-01T00:00:00.000Z") + offset * 24 * 60 * 60_000).toISOString().slice(0, 10),
    downloads: 0,
  }));
}

function currentRow(overrides: Partial<MetricsCurrentRow> = {}): MetricsCurrentRow {
  return {
    productId: mapping.productId,
    source: "npm",
    metric: "downloads_30d",
    sourceEntityId: mapping.primaryPackage!.id,
    sourceIdentity: "@scope/sdk",
    sourceUrl: "https://www.npmjs.com/package/%40scope%2Fsdk",
    lastAttemptAt: utcDateTime("2026-10-06T08:00:00.000Z"),
    lastStatus: "error",
    lastReason: "source_timeout",
    validValue: 0,
    validObservedAt: utcDateTime("2026-10-03T00:00:00.000Z"),
    validFetchedAt: utcDateTime("2026-10-03T00:00:00.000Z"),
    validPeriodStart: "2026-08-01",
    validPeriodEnd: "2026-08-30",
    validSeries: npmSeries(),
    runId: "00000000-0000-4000-8000-000000000011",
    updatedAt: utcDateTime("2026-10-06T08:00:00.000Z"),
    ...overrides,
  };
}

describe("metrics read model", () => {
  it("keeps last-valid zero and timestamps after a failed attempt, marked stale", () => {
    const values = buildMetricsReadModel({ rows: [currentRow()], mappings: [mapping], now });
    const downloads = values.find(({ metric }) => metric === "downloads_30d");
    expect(downloads).toMatchObject({
      status: "error",
      reason: "source_timeout",
      value: 0,
      observedAt: "2026-10-03T00:00:00.000Z",
      fetchedAt: "2026-10-03T00:00:00.000Z",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-30",
      freshness: "stale",
    });
  });

  it("does not show values belonging to a former source identity", () => {
    const previous = currentRow({
      source: "github",
      metric: "stars",
      sourceEntityId: repositoryId("repo_old_mapping"),
      sourceIdentity: "former-owner/former-repo",
      sourceUrl: "https://github.com/former-owner/former-repo",
      validValue: 123,
      validPeriodStart: null,
      validPeriodEnd: null,
      validSeries: null,
    });
    const values = buildMetricsReadModel({ rows: [previous], mappings: [mapping], now });
    expect(values.find(({ metric }) => metric === "stars")).toMatchObject({
      status: "not_collected",
      reason: "metrics_not_collected",
      value: null,
      freshness: "missing",
    });
  });

  it("reports unsupported package and repository metrics as not applicable", () => {
    const withoutSources: MappingIdentity = {
      productId: productId("prd_no_metrics_source"),
      primaryPackage: null,
      primaryRepository: null,
    };
    const values = buildMetricsReadModel({ rows: [], mappings: [withoutSources], now });
    expect(values).toHaveLength(4);
    expect(values.every(({ status, freshness, value }) => status === "not_applicable" && freshness === "not_applicable" && value === null)).toBe(true);
  });
});
