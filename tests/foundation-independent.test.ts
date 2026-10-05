import { describe, expect, it } from "vitest";
import { toPublishedCatalog, type CatalogSnapshot } from "../src/domain/catalog";
import { sanitizeAnalyticsEvent } from "../src/domain/measurement";
import { fixtureCatalogIdAllowlist, fixtureSnapshot } from "../src/server/fixtures/catalog";
import { publicRuntimeConfig } from "../src/server/config/public";
import { resolveAppEnvironment } from "../src/server/config/environment";
import { knownPageView } from "./fixtures/analytics-events";

describe("independent FP-02 boundary probes", () => {
  it("forces an explicitly untrusted PR to fixtures despite preview trust and production selection", () => {
    expect(resolveAppEnvironment({
      APP_ENV: "production",
      CI: "true",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_PULL_REQUEST_ID: "42",
      PKGCOMPASS_TRUSTED_PREVIEW: "true",
      GITHUB_EVENT_NAME: "pull_request",
    })).toBe("fixture");

    expect(resolveAppEnvironment({
      APP_ENV: "development",
      CI: "true",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_PULL_REQUEST_ID: "42",
      PKGCOMPASS_TRUSTED_PREVIEW: "true",
    })).toBe("development");
    expect(() => resolveAppEnvironment({ APP_ENV: "production" })).toThrow("environment");
  });

  it("rejects non-string enum objects without coercion and keeps them out of the public projection", () => {
    const hostileEnum = Object.create(null) as object;
    const sentinel = "review-hostile-enum-sentinel";
    const snapshot = {
      ...fixtureSnapshot,
      packages: fixtureSnapshot.packages.map((item, index) =>
        index === 0 ? { ...item, role: hostileEnum } : item,
      ),
    } as unknown as CatalogSnapshot;

    expect(() => toPublishedCatalog(snapshot)).not.toThrow();
    const output = toPublishedCatalog(snapshot);
    expect(JSON.stringify(output)).not.toContain(sentinel);
    expect(output.products[0].packages.map(({ id }) => id)).not.toContain("pkg_sanity_sdk");
  });

  it("binds page-view entity IDs to the route and this catalog's exact ID allowlist", () => {
    expect(sanitizeAnalyticsEvent({ ...knownPageView, routeType: "product" }, fixtureCatalogIdAllowlist))
      .toBeUndefined();
    expect(sanitizeAnalyticsEvent({
      ...knownPageView,
      entityId: "cat_not_in_this_catalog",
    }, fixtureCatalogIdAllowlist)).toBeUndefined();
    expect(sanitizeAnalyticsEvent(knownPageView, fixtureCatalogIdAllowlist)).toEqual(knownPageView);
  });

  it("exports only the public measurement settings when live config is valid", () => {
    const internalSentinel = "review-private-config-sentinel";
    const config = publicRuntimeConfig({
      APP_ENV: "development",
      NEXT_PUBLIC_POSTHOG_KEY: "public-test-key",
      NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
      SANITY_PROJECT_ID: internalSentinel,
      SANITY_DATASET: "development",
      SANITY_API_VERSION: "2026-10-01",
      DATABASE_READ_URL: `postgresql://reader:${internalSentinel}@db.example.invalid/metrics`,
      DATABASE_IMPORT_URL: `postgresql://writer:${internalSentinel}@db.example.invalid/metrics`,
      BREVO_API_KEY: internalSentinel,
      BREVO_REQUEST_LIST_ID: "123",
    });

    expect(config).toEqual({
      environment: "development",
      measurement: {
        enabled: true,
        key: "public-test-key",
        host: "https://eu.i.posthog.com",
      },
    });
    expect(JSON.stringify(config)).not.toContain(internalSentinel);
  });

  it("safely rejects a proxy at the sanitizer boundary", () => {
    const proxy = new Proxy({ ...knownPageView }, {
      getPrototypeOf() {
        throw new Error("review-proxy-trap-sentinel");
      },
    });

    expect(() => sanitizeAnalyticsEvent(proxy, fixtureCatalogIdAllowlist)).not.toThrow();
    expect(sanitizeAnalyticsEvent(proxy, fixtureCatalogIdAllowlist)).toBeUndefined();
  });
});
