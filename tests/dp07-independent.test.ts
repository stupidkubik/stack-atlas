import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateAiReadiness } from "../src/domain/ai-readiness";
import { buildDevelopmentSeedDocuments } from "../src/domain/seed-records";
import { computeMappingKey } from "../src/domain/mapping-key";
import { packageId, repositoryId, productId } from "../src/domain/ids";
import { aiReviewNeedsRefresh } from "../studio/badges/ai-review-age";
import { validatePublicationDraft } from "../studio/actions/publication-validation";

const cmsMocks = vi.hoisted(() => ({ catalog: vi.fn(), mappings: vi.fn() }));
vi.mock("../src/server/sanity/public-read", () => ({ getPublishedCatalogRead: cmsMocks.catalog }));
vi.mock("../src/server/sanity/published-mapping", () => ({ readPublishedMappings: cmsMocks.mappings }));
vi.mock("../src/server/config/targets", () => ({ selectComponentTarget: () => ({ mode: "fixture" }) }));
import { readPublicProduct } from "../src/server/catalog/read-model";

const now = new Date("2026-10-07T12:00:00.000Z");
const id = productId("prd_independent_ai");
const mappingKey = "a".repeat(64);
const checkedAt = "2026-10-01T12:00:00.000Z";

function review() {
  return {
    _id: `ai_review_${id}`, _type: "aiReview", id: `ai_review_${id}`,
    productId: id, state: "published", mappingKey, methodologyVersion: "cms-ai-support-v1",
    reviewedAt: checkedAt, reviewerLabel: "Independent fixture",
    signals: ["types", "llmsTxt", "mcp"].map((key) => ({
      key, state: "present", ...(key === "types" ? { kind: "bundled" } : {}),
      checkedAt: checkedAt as string | null, scope: "Synthetic documented check", reason: undefined as string | undefined,
      evidence: [{
        sourceUrl: "https://fixture.invalid/evidence", officialSourceUrl: "https://fixture.invalid/docs",
        finding: "Synthetic documented positive finding", checkedAt,
        ...(key === "types" ? { packageVersion: "1.2.3", entryPoints: ["."] } : {}),
      }],
    })),
  };
}
function calculate(publishedReview: unknown, overrides: { now?: Date; currentMappingKey?: string; hasComparableSdk?: boolean } = {}) {
  return calculateAiReadiness({ productId: id, currentMappingKey: mappingKey, hasComparableSdk: true, publishedReview, now, ...overrides });
}
function publishDraft(value = review()) {
  return { ...value, productId: { _type: "reference", _ref: id } };
}
const dependencies: Record<string, Record<string, unknown>> = {
  [id]: { _id: id, _type: "product", primaryPackageId: { _ref: "pkg_independent_ai" }, primaryRepositoryId: { _ref: "repo_independent_ai" } },
  pkg_independent_ai: { _id: "pkg_independent_ai", _type: "package", productId: { _ref: id }, role: "primary_js_sdk", packageName: "@fixture/sdk" },
  repo_independent_ai: { _id: "repo_independent_ai", _type: "repository", productId: { _ref: id }, role: "primary", owner: "fixture", name: "cms" },
};
const fetchPublished = async <Result = unknown>(_query: string, params?: Record<string, unknown>): Promise<Result> => dependencies[String(params?.id)] as Result;

describe("independent DP-07 contract acceptance (synthetic fixtures)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());

  it("distinguishes official positive evidence from a community-only MCP candidate", () => {
    expect(calculate(review()).score).toBe(100);
    const community = review();
    delete (community.signals[2].evidence[0] as { officialSourceUrl?: string }).officialSourceUrl;
    community.signals[2].evidence[0].sourceUrl = "https://community.invalid/mcp";
    expect(calculate(community).score).toBeNull();
  });

  it("does not award official llms.txt points for unsupported official ownership", () => {
    const candidate = review();
    delete (candidate.signals[1].evidence[0] as { officialSourceUrl?: string }).officialSourceUrl;
    expect(calculate(candidate).score).toBeNull();
  });

  it("keeps completed absence distinct from a failed request and preserves its reason", () => {
    const absent = review();
    absent.signals[2].state = "absent";
    absent.signals[2].evidence[0].finding = "Checked the documented official MCP integration list; no official MCP was listed.";
    expect(calculate(absent)).toMatchObject({ score: 69, completeness: "complete" });
    const error = review();
    error.signals[2].state = "error";
    error.signals[2].checkedAt = null;
    error.signals[2].evidence = [];
    error.signals[2].reason = "Official documentation returned HTTP 403; check could not finish.";
    const result = calculate(error);
    expect(result).toMatchObject({ score: null, evidenceAsOf: null, completeness: "incomplete" });
    expect(result.signals[2]).toMatchObject({ state: "error", reason: error.signals[2].reason });
  });

  it("uses the oldest required signal time and preserves the score after exactly 90 days", () => {
    const value = review();
    value.signals[1].checkedAt = "2026-07-09T12:00:00.000Z";
    value.signals[1].evidence[0].checkedAt = value.signals[1].checkedAt;
    expect(calculate(value)).toMatchObject({ score: 100, evidenceAsOf: value.signals[1].checkedAt, stale: false });
    expect(calculate(value, { now: new Date(now.getTime() + 1) })).toMatchObject({ score: 100, stale: true });
  });

  it("warns Studio only after 75 days using the oldest checked signal", () => {
    const value = review();
    value.signals[0].checkedAt = "2026-07-24T12:00:00.000Z";
    expect(aiReviewNeedsRefresh(value, now)).toBe(false);
    expect(aiReviewNeedsRefresh(value, new Date(now.getTime() + 1))).toBe(true);
    expect(aiReviewNeedsRefresh({ signals: [] }, now)).toBe(false);
    expect(aiReviewNeedsRefresh({ signals: [{ checkedAt: null }, {}, {}] }, now)).toBe(false);
  });

  it("does not expose old evidence under a new mapping or a draft review", () => {
    const value = calculate(review(), { currentMappingKey: "b".repeat(64) });
    expect(value).toMatchObject({ score: null, evidenceAsOf: null, completeness: "incomplete" });
    expect(value.signals.every((signal) => signal.state === "unknown" && signal.reason === "mapping_changed" && signal.evidence.length === 0)).toBe(true);
    expect(calculate({ ...review(), state: "draft" }).score).toBeNull();
  });

  it("preserves Studio incomplete signal reasons when GROQ returns null optional evidence", async () => {
    const actual = await vi.importActual<typeof import("../src/server/sanity/public-read")>("../src/server/sanity/public-read");
    const documents = await buildDevelopmentSeedDocuments();
    const ofType = (type: string) => documents.filter((document) => document._type === type);
    const raw = {
      categories: ofType("category"), categoryContent: ofType("categoryContent"), products: ofType("product"),
      packages: ofType("package"), repositories: ofType("repository"), productContent: ofType("productContent"),
      comparisons: ofType("comparison"), comparisonContent: ofType("comparisonContent"), pages: ofType("page"),
      siteSettings: ofType("siteSettings")[0], redirects: [],
      aiReviews: [{
        ...review(), _id: "ai_review_prd_sanity", productId: { _ref: "prd_sanity" },
        signals: ["types", "llmsTxt", "mcp"].map((key) => ({
          key, state: "error", scope: "Official documentation", reason: "Request timed out during manual check.",
          checkedAt: null, kind: null, evidence: null,
        })),
      }],
    };
    const projected = await actual.projectPublishedCmsRead(async () => raw);
    const aiReview = projected.catalog.products.find(({ product }) => product.id === "prd_sanity")?.aiReview;
    expect(aiReview?.signals).toHaveLength(3);
    expect(aiReview?.signals[2]).toMatchObject({ state: "error", reason: "Request timed out during manual check.", evidence: [] });
  });

  it("serves cached AI evidence without requiring a second live Sanity mapping read", async () => {
    const value = review();
    const mapping = {
      productId: id,
      primaryPackage: { id: packageId("pkg_independent_ai"), packageName: "@fixture/sdk" },
      primaryRepository: { id: repositoryId("repo_independent_ai"), owner: "fixture", name: "cms" },
      sdkPackageVersion: "1.2.3",
    };
    value.mappingKey = await computeMappingKey(mapping);
    const product = {
      product: { id, routeSlug: "independent-ai", primaryPackageId: mapping.primaryPackage.id, primaryRepositoryId: mapping.primaryRepository.id },
      packages: [mapping.primaryPackage], repositories: [mapping.primaryRepository], content: {},
    };
    cmsMocks.catalog.mockResolvedValue({ status: 200, source: "valid_cache", model: {
      products: [product], comparisons: [], catalog: { products: [{ product: product.product, aiReview: value }] },
    } });
    cmsMocks.mappings.mockRejectedValue(new Error("Synthetic upstream unavailable"));
    await expect(readPublicProduct("independent-ai", now)).resolves.toMatchObject({
      status: 200, source: "valid_cache", aiReadiness: { score: 100, completeness: "complete" },
    });
    expect(cmsMocks.mappings).not.toHaveBeenCalled();
    cmsMocks.catalog.mockResolvedValue({ status: 503 });
    await expect(readPublicProduct("independent-ai", now)).resolves.toEqual({ status: 503 });
  });

  it("keeps a public product applicable state when its SDK was removed after an older versioned review", async () => {
    const product = { product: { id, routeSlug: "independent-ai-no-sdk" }, packages: [], repositories: [], content: {} };
    cmsMocks.catalog.mockResolvedValue({ status: 200, source: "live", model: {
      products: [product], comparisons: [], catalog: { products: [{ product: product.product, aiReview: review() }] },
    } });
    await expect(readPublicProduct("independent-ai-no-sdk", now)).resolves.toMatchObject({
      status: 200, aiReadiness: { score: null, completeness: "not_applicable", evidenceAsOf: null },
    });
  });

  it("does not interpret no comparable SDK as a zero score", () => {
    expect(calculate(review(), { hasComparableSdk: false })).toMatchObject({ score: null, completeness: "not_applicable", evidenceAsOf: null });
  });

  it("allows a valid independently checked publication and calculates its mapping key", async () => {
    const result = await validatePublicationDraft(publishDraft(), fetchPublished);
    expect(result.errors).toEqual([]);
    expect(result.calculatedMappingKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("allows publishing honest incomplete checks without optional evidence arrays", async () => {
    const value = publishDraft();
    const signals = value.signals.map((signal) => ({
      key: signal.key, scope: signal.scope, state: "error", reason: "Manual source check timed out; no finding asserted.",
    }));
    const result = await validatePublicationDraft({ ...value, signals }, fetchPublished);
    expect(result.errors).toEqual([]);
    expect(result.calculatedMappingKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects publication of empty evidence objects that the reader cannot validate", async () => {
    const value = publishDraft();
    value.signals[2].evidence = [{}] as typeof value.signals[2]["evidence"];
    expect((await validatePublicationDraft(value, fetchPublished)).errors.length).toBeGreaterThan(0);
  });

  it("rejects publication of contradictory type state and kind", async () => {
    const value = publishDraft();
    value.signals[0].kind = "none";
    expect((await validatePublicationDraft(value, fetchPublished)).errors.length).toBeGreaterThan(0);
  });

  it("rejects publication of community-only MCP as official present", async () => {
    const value = publishDraft();
    delete (value.signals[2].evidence[0] as { officialSourceUrl?: string }).officialSourceUrl;
    expect((await validatePublicationDraft(value, fetchPublished)).errors.length).toBeGreaterThan(0);
  });

  it("rejects mixed versions before publishing a review that would invalidate mapping reads", async () => {
    const value = publishDraft();
    value.signals[0].evidence.push({ ...value.signals[0].evidence[0], packageVersion: "2.0.0" });
    expect((await validatePublicationDraft(value, fetchPublished)).errors.length).toBeGreaterThan(0);
  });
});
