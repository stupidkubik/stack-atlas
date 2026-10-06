import { describe, expect, it } from "vitest";
import { resolvePublicationReadiness } from "../src/domain/publication-readiness";
import { publicationReadinessFixtures as fixtures } from "./fixtures/publication-readiness";

describe("shared public publication readiness", () => {
  it("admits complete published content from live source and a valid cache", () => {
    expect(resolvePublicationReadiness(fixtures.livePublished)).toEqual({
      status: 200,
      source: "live",
      indexable: true,
    });
    expect(resolvePublicationReadiness(fixtures.cachedPublished)).toEqual({
      status: 200,
      source: "valid_cache",
      indexable: true,
    });
  });

  it.each([
    ["draft", fixtures.draft],
    ["incomplete direct publication", fixtures.incomplete],
    ["missing English locale", fixtures.missingLocale],
    ["unknown slug", fixtures.missingSlug],
  ] as const)("returns 404 for %s", (_name, input) => {
    expect(resolvePublicationReadiness(input)).toEqual({ status: 404 });
  });

  it("returns 503 only when the CMS is unavailable without a valid cached projection", () => {
    expect(resolvePublicationReadiness(fixtures.cmsUnavailable)).toEqual({ status: 503 });
  });

  it("keeps a complete comparison available while honoring an indexing opt-out", () => {
    expect(resolvePublicationReadiness(fixtures.nonIndexableComparison)).toEqual({
      status: 200,
      source: "live",
      indexable: false,
    });
  });
});
