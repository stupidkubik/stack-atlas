import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { utcDateTime } from "../src/domain/utc";
import { productId } from "../src/domain/ids";
import { createAdaptersForTargets, createFixtureAdapters } from "../src/server/adapters/fakes";
import { fixtureCatalogIdAllowlist } from "../src/server/fixtures/catalog";
import { readPublishedCatalog } from "../src/server/read-service";
import { knownPageView } from "./fixtures/analytics-events";

describe("offline fixture and explicit live adapter boundaries", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => {
      throw new Error("offline fixture fetch must never run");
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs content, metric, CRM, and measurement fakes without any fetch", async () => {
    const adapters = createFixtureAdapters(fixtureCatalogIdAllowlist);
    const content = await adapters.content.getPublishedCatalog();
    expect(content.ok).toBe(true);
    if (!content.ok) throw new Error("fixture content should be available");

    const products = content.value.products.map(({ product }) => product.id);
    const metrics = await adapters.metricsReader.readCurrent(products);
    expect(metrics.ok).toBe(true);
    if (!metrics.ok) throw new Error("fixture metrics should be available");
    expect(metrics.value.length).toBeGreaterThan(0);

    const write = await adapters.metricsWriter.replaceForProduct(
      products[0],
      metrics.value.filter(({ productId }) => productId === products[0]),
    );
    expect(write).toEqual({ ok: true, value: { written: 1 } });

    const opaqueSentinel = "opaque-test-sentinel-no-real-address";
    const crmResult = await adapters.crm.upsertRequest({
      email: opaqueSentinel,
      scenario: "marketing_site",
      contactPermissionAt: utcDateTime("2026-10-05T12:00:00.000Z"),
    });
    expect(crmResult).toEqual({ ok: true, value: { accepted: true } });
    expect(adapters.acceptedRequestCount()).toBe(1);
    expect(JSON.stringify(adapters)).not.toContain(opaqueSentinel);

    const capture = await adapters.measurement.capture(knownPageView);
    expect(capture).toEqual({ ok: true, value: { captured: true } });
    expect(adapters.measurementSnapshot()).toEqual([knownPageView]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns adapter_unavailable for live targets instead of serving fixture data", async () => {
    const liveTarget = { mode: "live" as const };
    const ports = createAdaptersForTargets({
      content: liveTarget,
      metricsReader: liveTarget,
      metricsWriter: liveTarget,
      crm: liveTarget,
      measurement: liveTarget,
    }, fixtureCatalogIdAllowlist);

    expect(await ports.content.getPublishedCatalog()).toEqual({ ok: false, code: "adapter_unavailable" });
    expect(await ports.metricsReader.readCurrent([])).toEqual({ ok: false, code: "adapter_unavailable" });
    expect(await ports.metricsWriter.replaceForProduct(productId("prd_sanity"), [])).toEqual({
      ok: false,
      code: "adapter_unavailable",
    });
    expect(await ports.crm.upsertRequest({
      email: "opaque-test-sentinel-no-real-address",
      scenario: "marketing_site",
      contactPermissionAt: utcDateTime("2026-10-05T12:00:00.000Z"),
    })).toEqual({ ok: false, code: "adapter_unavailable" });
    expect(await ports.measurement.capture(knownPageView)).toEqual({
      ok: false,
      code: "adapter_unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("minimal published catalog read service", () => {
  it("returns 503 without cache when CMS is unavailable and skips the metrics port", async () => {
    const metrics = { readCurrent: vi.fn() };
    const result = await readPublishedCatalog({
      async getPublishedCatalog() {
        return { ok: false, code: "cms_unavailable" };
      },
    }, metrics);
    expect(result).toEqual({ status: 503, code: "cms_unavailable" });
    expect(metrics.readCurrent).not.toHaveBeenCalled();
  });

  it("does not disclose thrown CMS details", async () => {
    const secret = "cms-error-secret-sentinel";
    const result = await readPublishedCatalog({
      async getPublishedCatalog() {
        throw new Error(secret);
      },
    }, { readCurrent: vi.fn() });
    expect(result).toEqual({ status: 503, code: "cms_unavailable" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("keeps published content when SQL metrics are unavailable", async () => {
    const content = {
      async getPublishedCatalog() {
        return createFixtureAdapters(fixtureCatalogIdAllowlist).content.getPublishedCatalog();
      },
    };
    const metrics = {
      async readCurrent() {
        throw new Error("database-error-secret-sentinel");
      },
    };
    const result = await readPublishedCatalog(content, metrics);
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error("content should survive metrics failure");
    expect(result.catalog.products).toHaveLength(5);
    expect(result.metrics).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("database-error-secret-sentinel");
  });
});
