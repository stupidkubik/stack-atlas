import { describe, expect, it } from "vitest";
import { toPublishedCatalog } from "../src/domain/catalog";
import { packageId, productId } from "../src/domain/ids";
import { FIXTURE_CATEGORY_ID, FIXTURE_LABEL, completeAiReviewFixture, fixturePublishedCatalog, fixtureSnapshot, incompleteAiReviewFixture, repositoryRenameFixtureSnapshot } from "../src/server/fixtures/catalog";
import {
  syntheticGitHubRepositoryResponse,
  syntheticNpmFullPeriodResponse,
  syntheticNpmIncompletePeriodResponse,
} from "../src/server/fixtures/api-responses";

describe("foundation synthetic catalog fixtures", () => {
  it("contains five visibly labelled CMS fixtures with scoped SDK, monorepo, and no-SDK cases", () => {
    const names = fixturePublishedCatalog.products.map(({ product }) => product.displayName);
    expect(names).toEqual([
      "Sanity (synthetic fixture)",
      "Contentful (synthetic fixture)",
      "Strapi (synthetic fixture)",
      "Payload (synthetic fixture)",
      "Directus (synthetic fixture)",
    ]);
    expect(fixturePublishedCatalog.products[0].packages.map(({ packageName }) => packageName))
      .toContain("@fixture/sanity-sdk");
    expect(fixturePublishedCatalog.products[0].packages).toHaveLength(2);
    expect(fixturePublishedCatalog.products[0].repositories[0].name).toBe("sanity-monorepo");
    expect(fixturePublishedCatalog.products[4].packages).toEqual([]);
    expect(fixturePublishedCatalog.products[4].content.noPackageReason).toContain("Synthetic fixture");
    expect(FIXTURE_LABEL).toContain("not vendor verification");
    expect(fixturePublishedCatalog.products.flatMap(({ packages, repositories }) => [
      ...packages.map(({ officialSourceUrl }) => officialSourceUrl),
      ...repositories.map(({ officialSourceUrl }) => officialSourceUrl),
    ]).every((url) => url.startsWith("https://example.invalid/"))).toBe(true);
    expect(FIXTURE_CATEGORY_ID).toBe("cat_headless_cms");
  });

  it("has one canonical pair and stable source identity across a synthetic rename", () => {
    expect(fixturePublishedCatalog.comparisons).toHaveLength(1);
    const comparison = fixturePublishedCatalog.comparisons[0].comparison;
    expect(comparison.productIds[0] < comparison.productIds[1]).toBe(true);
    expect(comparison.pairKey).toBe(JSON.stringify(comparison.productIds));

    const renamedCatalog = toPublishedCatalog(repositoryRenameFixtureSnapshot);
    expect(renamedCatalog.products[0].repositories[0]).toMatchObject({
      id: "repo_sanity_monorepo",
      name: "sanity-monorepo-renamed",
    });
  });

  it("supplies complete and incomplete three-signal inputs without a stored score", () => {
    for (const review of [completeAiReviewFixture, incompleteAiReviewFixture]) {
      expect(review.signals.map(({ key }) => key)).toEqual(["types", "llmsTxt", "mcp"]);
      expect(review.methodologyVersion).toBe("fixture-methodology-v0");
      expect(review.reviewedAt).toMatch(/Z$/);
      expect(review.signals.every((signal) => signal.checkedAt?.endsWith("Z"))).toBe(true);
      expect(review.signals.every((signal) => signal.evidence.length === 1)).toBe(true);
      expect(review.signals.flatMap((signal) => signal.evidence).every((item) =>
        item.sourceUrl.startsWith("https://example.invalid/") && item.finding.includes("Synthetic fixture"),
      )).toBe(true);
      expect(review).not.toHaveProperty("score");
    }
    expect(completeAiReviewFixture.signals.every(({ state }) => state === "present")).toBe(true);
    expect(incompleteAiReviewFixture.signals.some(({ state }) => state === "unknown" || state === "error")).toBe(true);
  });

  it("keeps the neutral draft marker out even if a draft is incorrectly marked published", () => {
    const draftId = productId("prd_synthetic_draft_marker");
    const invalidlyPublished = {
      ...fixtureSnapshot,
      products: fixtureSnapshot.products.map((product) =>
        product.id === draftId ? { ...product, state: "published" as const } : product,
      ),
      productContent: fixtureSnapshot.productContent.map((content) =>
        content.productId === draftId ? { ...content, state: "published" as const } : content,
      ),
    };
    const output = toPublishedCatalog(invalidlyPublished);
    expect(output.products.some(({ product }) => product.id === draftId)).toBe(false);
    expect(JSON.stringify(output)).not.toContain("Synthetic unpublished fixture marker");
  });

  it("constructs a allowlisted public projection and drops private/runtime fields", () => {
    const sentinel = "private-payload-fixture-sentinel";
    const withRuntimeFields = {
      ...fixtureSnapshot,
      products: fixtureSnapshot.products.map((product, index) =>
        index === 0 ? { ...product, privateNotes: sentinel, analyticsRequestId: sentinel } : product,
      ),
      productContent: fixtureSnapshot.productContent.map((content, index) =>
        index === 0 ? { ...content, privateDraftText: sentinel } : content,
      ),
      packages: fixtureSnapshot.packages.map((item, index) =>
        index === 0 ? { ...item, secretCredential: sentinel } : item,
      ),
      aiReviews: fixtureSnapshot.aiReviews.map((review, index) =>
        index === 0 ? { ...review, overrideReason: sentinel, previousFinding: sentinel } : review,
      ),
      comparisons: fixtureSnapshot.comparisons.map((comparison) => ({ ...comparison, privateNotes: sentinel })),
    };
    const output = toPublishedCatalog(withRuntimeFields);
    expect(JSON.stringify(output)).not.toContain(sentinel);
    expect(JSON.stringify(output)).not.toContain("privateNotes");
    expect(JSON.stringify(output)).not.toContain("privateDraftText");
    expect(JSON.stringify(output)).not.toContain("secretCredential");
    expect(Object.hasOwn(output.products[0].product, "toJSON")).toBe(false);
  });

  it("requires relationship ownership and a canonical distinct comparison pair", () => {
    const sanityId = productId("prd_sanity");
    const orphanPackageId = packageId("pkg_orphan_scope");
    const invalid = {
      ...fixtureSnapshot,
      products: fixtureSnapshot.products.map((product) => product.id === sanityId
        ? { ...product, packageIds: [...product.packageIds, orphanPackageId] }
        : product,
      ),
      packages: [...fixtureSnapshot.packages, {
        id: orphanPackageId,
        productId: productId("prd_contentful"),
        packageName: "@fixture/wrong-owner",
        role: "additional" as const,
        officialSourceUrl: "https://example.invalid/fixture/wrong-owner",
      }],
      comparisons: fixtureSnapshot.comparisons.map((comparison) => ({
        ...comparison,
        productIds: [comparison.productIds[1], comparison.productIds[0]] as const,
      })),
    } as unknown as typeof fixtureSnapshot;
    const output = toPublishedCatalog(invalid);
    expect(output.products[0].packages.some(({ id }) => id === orphanPackageId)).toBe(false);
    expect(output.comparisons).toEqual([]);
  });

  it("rejects hostile non-string enum values without coercing them", () => {
    const sentinel = "hostile-enum-coercion-was-called";
    const hostileEnum = {
      toString() {
        throw new Error(sentinel);
      },
    };
    const invalid = {
      ...fixtureSnapshot,
      packages: fixtureSnapshot.packages.map((item, index) =>
        index === 0 ? { ...item, role: hostileEnum } : item,
      ),
      aiReviews: fixtureSnapshot.aiReviews.map((review, index) => index === 0
        ? {
            ...review,
            signals: [
              { ...review.signals[0], state: hostileEnum },
              review.signals[1],
              review.signals[2],
            ] as unknown as typeof review.signals,
          }
        : review,
      ),
    } as unknown as typeof fixtureSnapshot;
    expect(() => toPublishedCatalog(invalid)).not.toThrow();
    const output = toPublishedCatalog(invalid);
    expect(JSON.stringify(output)).not.toContain(sentinel);
  });

  it("includes offline synthetic npm period and GitHub API shapes", () => {
    expect(syntheticNpmFullPeriodResponse.fixtureLabel).toContain("synthetic");
    expect(syntheticNpmFullPeriodResponse.downloads).toHaveLength(30);
    expect(syntheticNpmIncompletePeriodResponse.downloads.length)
      .toBeLessThan(syntheticNpmFullPeriodResponse.downloads.length);
    expect(syntheticGitHubRepositoryResponse.html_url).toContain("example.invalid");
    expect(syntheticGitHubRepositoryResponse.stargazers_count).toBe(0);
  });
});
