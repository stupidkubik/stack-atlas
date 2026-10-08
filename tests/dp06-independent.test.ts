import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { packageId, productId, repositoryId } from "../src/domain/ids";
import type { MetricsCurrentRow } from "../src/domain/data-contracts";
import { utcDateTime } from "../src/domain/utc";
import { buildMetricsReadModel } from "../src/domain/metrics-read-model";
import type { CmsPublicProduct } from "../src/server/sanity/public-read";

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(), mappings: vi.fn(), reader: vi.fn(), target: vi.fn(),
}));
vi.mock("../src/server/sanity/public-read", () => ({ getPublishedCatalogRead: mocks.catalog }));
vi.mock("../src/server/sanity/published-mapping", () => ({ readPublishedMappings: mocks.mappings }));
vi.mock("../src/server/db/connections", () => ({ createPooledMetricsReader: mocks.reader }));
vi.mock("../src/server/config/targets", () => ({ selectComponentTarget: mocks.target }));

import { readPublicProduct } from "../src/server/catalog/read-model";

const now = new Date("2026-10-07T12:00:00.000Z");
const mapping = {
  productId: productId("prd_independent"),
  primaryPackage: { id: packageId("pkg_independent"), packageName: "@fixture/sdk" },
  primaryRepository: { id: repositoryId("repo_independent"), owner: "fixture", name: "cms" },
  sdkPackageVersion: null as string | null,
  mappingKey: "before-review-publication",
};
const product: CmsPublicProduct = {
  product: {
    id: mapping.productId, displayName: "Independent fixture", routeSlug: "independent-fixture",
    categoryIds: [], officialWebsiteUrl: "https://example.invalid/", officialDocsUrl: "https://example.invalid/docs/",
    hostingModels: [], apiStyles: [], packageIds: [mapping.primaryPackage.id], repositoryIds: [mapping.primaryRepository.id],
    primaryPackageId: mapping.primaryPackage.id, primaryRepositoryId: mapping.primaryRepository.id,
  },
  content: {
    summary: "Published editorial content survives metrics failures.", useCases: [], fitsWhen: [], avoidWhen: [], limitations: [],
    integrationNotes: [], criteriaBlocks: [], sources: [], alternativeIds: [], reviewedAt: "2026-10-06T12:00:00.000Z",
    seo: { title: "Independent fixture", description: "Synthetic editorial fixture." },
  },
  packages: [{ id: mapping.primaryPackage.id, packageName: mapping.primaryPackage.packageName, role: "primary_js_sdk", officialSourceUrl: "https://example.invalid/sdk" }],
  repositories: [{ id: mapping.primaryRepository.id, owner: "fixture", name: "cms", role: "primary", scope: "product", officialSourceUrl: "https://example.invalid/repository" }],
};
function row(overrides: Partial<MetricsCurrentRow> = {}): MetricsCurrentRow {
  return {
    productId: mapping.productId, source: "github", metric: "stars",
    sourceEntityId: mapping.primaryRepository.id, sourceIdentity: "fixture/cms", sourceUrl: "https://github.com/fixture/cms",
    lastAttemptAt: utcDateTime(now.toISOString()), lastStatus: "error", lastReason: "source_timeout",
    validValue: 0, validObservedAt: utcDateTime("2026-10-06T12:00:00.000Z"), validFetchedAt: utcDateTime("2026-10-06T12:00:00.000Z"),
    validPeriodStart: null, validPeriodEnd: null, validSeries: null,
    runId: "00000000-0000-4000-8000-000000000099", updatedAt: utcDateTime(now.toISOString()), ...overrides,
  };
}
function databaseRows(rows: readonly MetricsCurrentRow[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return { db: { select: () => ({ from: () => ({ where }) }) } as unknown as NodePgDatabase, where };
}

describe("independent DP-06 acceptance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    mocks.catalog.mockResolvedValue({
      status: 200, source: "live",
      model: { products: [product], comparisons: [], catalog: { products: [{ product: product.product }] } },
    });
    mocks.mappings.mockResolvedValue({ ok: true, value: [mapping] });
    mocks.target.mockReturnValue({ mode: "live" });
  });
  afterEach(() => vi.useRealTimers());

  it("returns the real published product with HTTP read status 200 on a SQL rejection and closes the pool", async () => {
    const sql = databaseRows([]);
    sql.where.mockRejectedValue(new Error("synthetic-database-private-detail"));
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.reader.mockReturnValue({ db: sql.db, close });
    const result = await readPublicProduct(product.product.routeSlug, now);
    expect(result).toMatchObject({ status: 200, product, metrics: { status: "unavailable" } });
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("synthetic-database-private-detail");
  });

  it("keeps editorial content when pool creation throws before a query", async () => {
    mocks.reader.mockImplementation(() => { throw new Error("synthetic-connect-failure"); });
    await expect(readPublicProduct(product.product.routeSlug, now)).resolves.toMatchObject({
      status: 200, product, metrics: { status: "unavailable" },
    });
  });

  it("retains identical source metrics across a review-driven mappingKey and SDK version change", async () => {
    const sql = databaseRows([row()]);
    mocks.reader.mockReturnValue({ db: sql.db, close: async () => {} });
    const before = await readPublicProduct(product.product.routeSlug, now);
    mocks.mappings.mockResolvedValue({ ok: true, value: [{ ...mapping, sdkPackageVersion: "2.0.0", mappingKey: "after-review-publication" }] });
    const after = await readPublicProduct(product.product.routeSlug, now);
    expect(before.status).toBe(200);
    expect(after.status).toBe(200);
    if (before.status !== 200 || after.status !== 200) throw new Error("Expected published product");
    expect(after.metrics).toEqual(before.metrics);
    expect(after.metrics).toMatchObject({ status: "available", values: expect.arrayContaining([
      expect.objectContaining({ metric: "stars", value: 0, status: "error", freshness: "fresh" }),
    ]) });
  });

  it("does not hide SQL metrics when the AI-dependent mapping projection is invalid", async () => {
    const sql = databaseRows([row()]);
    mocks.reader.mockReturnValue({ db: sql.db, close: async () => {} });
    mocks.mappings.mockResolvedValue({ ok: false, code: "invalid_response" });
    const result = await readPublicProduct(product.product.routeSlug, now);
    expect(result).toMatchObject({ status: 200, product, metrics: { status: "available", values: expect.arrayContaining([
      expect.objectContaining({ metric: "stars", value: 0, lastAttemptAt: now.toISOString(), fetchedAt: "2026-10-06T12:00:00.000Z" }),
    ]) } });
    expect(sql.where).toHaveBeenCalledOnce();
  });

  it("distinguishes a real last-valid zero from a failed first attempt without a value", () => {
    const zero = buildMetricsReadModel({ rows: [row()], mappings: [mapping], now });
    const missing = buildMetricsReadModel({ rows: [row({ validValue: null, validObservedAt: null, validFetchedAt: null })], mappings: [mapping], now });
    expect(zero.find(({ metric }) => metric === "stars")).toMatchObject({ value: 0, freshness: "fresh", status: "error" });
    expect(missing.find(({ metric }) => metric === "stars")).toMatchObject({ value: null, freshness: "missing", status: "error", lastAttemptAt: now.toISOString() });
  });

  it("reports no selected sources as not applicable even if old source rows exist", () => {
    const result = buildMetricsReadModel({ rows: [row()], mappings: [{ productId: mapping.productId, primaryPackage: null, primaryRepository: null }], now });
    expect(result).toHaveLength(4);
    for (const value of result) expect(value).toMatchObject({ value: null, status: "not_applicable", freshness: "not_applicable", lastAttemptAt: null });
  });

  it.each([
    { sourceEntityId: repositoryId("repo_previous") },
    { sourceIdentity: "fixture/previous-cms" },
  ])("rejects a previous entity ID or exact source identity independently: %j", (changed) => {
    const result = buildMetricsReadModel({ rows: [row(changed)], mappings: [mapping], now });
    expect(result.find(({ metric }) => metric === "stars")).toMatchObject({ value: null, status: "not_collected", freshness: "missing" });
  });

  it.each([
    ["2026-10-05T12:00:00.000Z", "fresh"],
    ["2026-10-05T11:59:59.999Z", "stale"],
  ])("classifies last-valid freshness at the exact 48-hour boundary: %s", (fetchedAt, freshness) => {
    const result = buildMetricsReadModel({ rows: [row({ validFetchedAt: utcDateTime(fetchedAt) })], mappings: [mapping], now });
    expect(result.find(({ metric }) => metric === "stars")).toMatchObject({ value: 0, status: "error", freshness });
  });
});
