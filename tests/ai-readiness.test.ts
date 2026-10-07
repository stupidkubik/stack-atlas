import { describe, expect, it } from "vitest";
import { calculateAiReadiness } from "../src/domain/ai-readiness";
import { productId } from "../src/domain/ids";
import { readPublishedAiReadiness } from "../src/server/catalog/ai-review";
import { dataMappingFixtures } from "./fixtures/data/mappings";

const fixedNow = new Date("2026-10-06T08:00:00.000Z");

function review(mappingKey: string, kinds: { types: "bundled" | "external" | "none"; llmsTxt: boolean; mcp: boolean }, checkedAt = "2026-10-01T00:00:00.000Z") {
  const product = productId("prd_fixture_scoped");
  const signal = (key: "types" | "llmsTxt" | "mcp", state: "present" | "absent", kind?: "bundled" | "external" | "none") => ({
    key,
    state,
    ...(key === "types" ? { kind } : {}),
    checkedAt,
    scope: `${key} documented check`,
    evidence: [{
      sourceUrl: "https://docs.example.test/check",
      officialSourceUrl: "https://docs.example.test/",
      finding: `${key} synthetic evidence`,
      checkedAt,
      ...(key === "types" ? { packageVersion: "2.1.0", entryPoints: ["index.d.ts"] } : {}),
    }],
  });
  return {
    id: `ai_review_${product}`,
    productId: product,
    state: "published",
    mappingKey,
    methodologyVersion: "cms-ai-support-v1",
    reviewedAt: checkedAt,
    signals: [
      signal("types", kinds.types === "none" ? "absent" : "present", kinds.types),
      signal("llmsTxt", kinds.llmsTxt ? "present" : "absent"),
      signal("mcp", kinds.mcp ? "present" : "absent"),
    ],
  };
}

describe("published AI readiness", () => {
  const mappingKey = "a".repeat(64);
  const base = {
    productId: productId("prd_fixture_scoped"),
    currentMappingKey: mappingKey,
    hasComparableSdk: true,
    now: fixedNow,
  };

  it("calculates the fixed denominator and half-up score for complete reviews", () => {
    expect(calculateAiReadiness({
      ...base,
      publishedReview: review(mappingKey, { types: "bundled", llmsTxt: false, mcp: false }),
    }).score).toBe(38);
    expect(calculateAiReadiness({
      ...base,
      publishedReview: review(mappingKey, { types: "bundled", llmsTxt: true, mcp: false }),
    }).score).toBe(69);
    expect(calculateAiReadiness({
      ...base,
      publishedReview: review(mappingKey, { types: "external", llmsTxt: true, mcp: true }),
    }).score).toBe(81);
    expect(calculateAiReadiness({
      ...base,
      publishedReview: review(mappingKey, { types: "bundled", llmsTxt: true, mcp: true }),
    }).score).toBe(100);
  });

  it("keeps errors, mapping changes, and absent SDK separate from a negative score", () => {
    const mismatch = calculateAiReadiness({
      ...base,
      currentMappingKey: "b".repeat(64),
      publishedReview: review(mappingKey, { types: "bundled", llmsTxt: true, mcp: true }),
    });
    expect(mismatch).toMatchObject({ completeness: "incomplete", score: null });
    expect(mismatch.signals).toHaveLength(3);
    expect(mismatch.signals.every((signal) => signal.state === "unknown" && signal.reason === "mapping_changed")).toBe(true);

    const noSdk = calculateAiReadiness({
      ...base,
      hasComparableSdk: false,
      publishedReview: review(mappingKey, { types: "bundled", llmsTxt: true, mcp: true }),
    });
    expect(noSdk).toMatchObject({ completeness: "not_applicable", score: null });

    const malformed = review(mappingKey, { types: "bundled", llmsTxt: true, mcp: true });
    malformed.signals[0].evidence = [];
    expect(calculateAiReadiness({ ...base, publishedReview: malformed })).toMatchObject({ completeness: "incomplete", score: null });
  });

  it("marks completed evidence stale only after 90 days and reads published mappings only", () => {
    const fresh = calculateAiReadiness({
      ...base,
      publishedReview: review(mappingKey, { types: "bundled", llmsTxt: true, mcp: true }, "2026-07-10T00:00:00.000Z"),
    });
    const stale = calculateAiReadiness({
      ...base,
      publishedReview: review(mappingKey, { types: "bundled", llmsTxt: true, mcp: true }, "2026-07-07T00:00:00.000Z"),
    });
    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(calculateAiReadiness({
      ...base,
      publishedReview: { ...review(mappingKey, { types: "bundled", llmsTxt: true, mcp: true }), state: "draft" },
    }).score).toBeNull();
    expect(dataMappingFixtures.noSdk.primaryPackage).toBeNull();
  });

  it("keeps the exact 90-day boundary fresh and returns unavailable on a CMS read failure", async () => {
    const boundaryReview = review(mappingKey, { types: "bundled", llmsTxt: true, mcp: true }, "2026-07-08T08:00:00.000Z");
    expect(calculateAiReadiness({ ...base, publishedReview: boundaryReview }).stale).toBe(false);

    const result = await readPublishedAiReadiness({
      readMappings: async () => ({ ok: true, value: [{
        productId: base.productId,
        mappingKey,
        hasComparableSdk: true,
      }] }),
      readReviews: async () => ({ ok: true, value: [boundaryReview] }),
      now: fixedNow,
    });
    expect(result).toMatchObject({ status: "available", values: [{ score: 100, stale: false }] });

    await expect(readPublishedAiReadiness({
      readMappings: async () => ({ ok: false }),
      readReviews: async () => ({ ok: true, value: [boundaryReview] }),
      now: fixedNow,
    })).resolves.toEqual({ status: "unavailable" });
  });
});
