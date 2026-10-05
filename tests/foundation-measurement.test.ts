import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsEvent } from "../src/domain/measurement";
import { conversionId, eventId } from "../src/domain/ids";
import { fixtureCatalogIdAllowlist } from "../src/server/fixtures/catalog";
import { knownPageView } from "./fixtures/analytics-events";

describe("measurement allowlist boundary", () => {
  it("returns a fresh object containing only supported fields and own catalog IDs", () => {
    const input = { ...knownPageView };
    const result = sanitizeAnalyticsEvent(input, fixtureCatalogIdAllowlist);
    expect(result).toEqual(knownPageView);
    expect(result).not.toBe(input);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result ?? {}).sort()).toEqual([
      "entityId",
      "environment",
      "eventId",
      "eventSchemaVersion",
      "locale",
      "name",
      "occurredAt",
      "routeType",
    ].sort());
  });

  it("rejects regex-valid product IDs outside this catalog's own allowlist", () => {
    const unknownProduct = {
      ...knownPageView,
      entityId: "prd_not_in_this_fixture_catalog",
    };
    expect(sanitizeAnalyticsEvent(unknownProduct, fixtureCatalogIdAllowlist)).toBeUndefined();
  });

  it("binds page-view IDs to their matching route type", () => {
    expect(sanitizeAnalyticsEvent({
      ...knownPageView,
      routeType: "product",
      entityId: "cat_headless_cms",
    }, fixtureCatalogIdAllowlist)).toBeUndefined();
    expect(sanitizeAnalyticsEvent({
      ...knownPageView,
      routeType: "methodology",
      entityId: "cat_headless_cms",
    }, fixtureCatalogIdAllowlist)).toBeUndefined();
  });

  it("accepts only an allowlisted conversion ID mirrored by the event ID", () => {
    const id = "00000000-0000-4000-8000-000000000003";
    const accepted = {
      eventSchemaVersion: 1 as const,
      environment: "development" as const,
      routeType: "lead_form" as const,
      locale: "en" as const,
      occurredAt: knownPageView.occurredAt,
      eventId: eventId(id),
      name: "lead_accepted" as const,
      conversionId: conversionId(id),
      scenario: "marketing_site" as const,
      campaignKey: "portfolio" as const,
    };
    expect(sanitizeAnalyticsEvent(accepted, fixtureCatalogIdAllowlist)).toEqual(accepted);
    expect(sanitizeAnalyticsEvent({ ...accepted, eventId: knownPageView.eventId }, fixtureCatalogIdAllowlist))
      .toBeUndefined();
    expect(sanitizeAnalyticsEvent({ ...accepted, campaignKey: "raw-campaign" }, fixtureCatalogIdAllowlist))
      .toBeUndefined();
  });

  it("rejects PII, URLs, query/referrer, request IDs, and arbitrary properties", () => {
    const raw = "must-not-escape-sanitizer";
    for (const extra of [
      { email: raw },
      { fullUrl: `https://example.invalid/?q=${raw}` },
      { referrer: raw },
      { requestId: raw },
      { arbitraryError: { message: raw, cause: raw } },
    ]) {
      expect(sanitizeAnalyticsEvent({ ...knownPageView, ...extra }, fixtureCatalogIdAllowlist)).toBeUndefined();
    }
  });

  it("rejects inherited prototypes, toJSON, symbols, hidden keys, and accessors without invoking them", () => {
    const raw = "non-public-payload-sentinel";
    const inherited = Object.assign(Object.create({ toJSON: () => raw }), knownPageView);
    expect(sanitizeAnalyticsEvent(inherited, fixtureCatalogIdAllowlist)).toBeUndefined();

    const customToJson = { ...knownPageView, toJSON: () => raw };
    expect(sanitizeAnalyticsEvent(customToJson, fixtureCatalogIdAllowlist)).toBeUndefined();

    const symbolKey = Symbol("private");
    const withSymbol = { ...knownPageView, [symbolKey]: raw };
    expect(sanitizeAnalyticsEvent(withSymbol, fixtureCatalogIdAllowlist)).toBeUndefined();

    const hidden = { ...knownPageView };
    Object.defineProperty(hidden, "privatePayload", { value: raw, enumerable: false });
    expect(sanitizeAnalyticsEvent(hidden, fixtureCatalogIdAllowlist)).toBeUndefined();

    let getterCalls = 0;
    const accessor = { ...knownPageView };
    Object.defineProperty(accessor, "privatePayload", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return raw;
      },
    });
    expect(sanitizeAnalyticsEvent(accessor, fixtureCatalogIdAllowlist)).toBeUndefined();
    expect(getterCalls).toBe(0);
  });

  it("never serializes runtime data attached to the input", () => {
    const raw = "private-cause-and-request-sentinel";
    const input = {
      ...knownPageView,
      cause: { message: raw, requestId: raw },
      error: new Error(raw),
    };
    const result = sanitizeAnalyticsEvent(input, fixtureCatalogIdAllowlist);
    expect(result).toBeUndefined();
    expect(JSON.stringify(result) ?? "").not.toContain(raw);
  });
});
