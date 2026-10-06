import { describe, expect, it } from "vitest";
import { conversionId } from "../src/domain/ids";
import { createCatalogIdAllowlist, sanitizeAnalyticsEvent } from "../src/domain/measurement";
import {
  campaignKeyFromUtm,
  makeLeadAccepted,
  makeLeadFormViewed,
  makePageViewed,
  routeTypeForPath,
} from "../src/features/measurement/events";

const emptyCatalog = createCatalogIdAllowlist({ productIds: [], comparisonIds: [], categoryIds: [] });
const acceptedId = conversionId("78a8d916-f022-4120-a93a-8a97a4672aac");

describe("consent-gated measurement event contracts", () => {
  it("constructs only typed page and form events", () => {
    expect(makePageViewed("lead_form", "development")).toMatchObject({
      name: "page_viewed",
      routeType: "lead_form",
      eventSchemaVersion: 1,
      locale: "en",
    });
    expect(makeLeadFormViewed("comparison", "development")).toMatchObject({
      name: "lead_form_viewed",
      routeType: "lead_form",
      entryPoint: "comparison",
    });
  });

  it("ties accepted event identity to conversion ID and excludes unknown properties", () => {
    const event = makeLeadAccepted(acceptedId, "editorial_site", "portfolio", "development");
    expect(event).toMatchObject({
      name: "lead_accepted",
      conversionId: acceptedId,
      eventId: acceptedId,
      scenario: "editorial_site",
      campaignKey: "portfolio",
    });
    expect(sanitizeAnalyticsEvent({ ...event, email: "synthetic@example.invalid" }, emptyCatalog)).toBeUndefined();
  });

  it("normalizes only exact campaign allowlist combinations", () => {
    expect(campaignKeyFromUtm({ source: "Portfolio", medium: "referral", campaign: "PkgCompass" })).toBe("portfolio");
    expect(campaignKeyFromUtm({ source: "demo", medium: "referral", campaign: "pkgcompass" })).toBe("demo");
    expect(campaignKeyFromUtm({ source: "unknown", medium: "referral", campaign: "pkgcompass" })).toBeUndefined();
    expect(campaignKeyFromUtm({ source: "portfolio", medium: "paid", campaign: "pkgcompass" })).toBeUndefined();
  });

  it("classifies only known public routes, never admin or API routes", () => {
    expect(routeTypeForPath("/en/request-shortlist/")).toBe("lead_form");
    expect(routeTypeForPath("/en/request-shortlist/?q=private")).toBeUndefined();
    expect(routeTypeForPath("/studio/desk")).toBeUndefined();
    expect(routeTypeForPath("/api/leads")).toBeUndefined();
    expect(routeTypeForPath("/en/compare/headless-vs-classic/")).toBe("comparison");
  });
});
