import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { productId } from "../src/domain/ids";
import { utcDateTime } from "../src/domain/utc";
import type { MetricReadValue } from "../src/domain/metrics-read-model";
import type { PublicProductRead } from "../src/server/catalog/read-model";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("next/headers", () => ({ draftMode: async () => ({ isEnabled: false }) }));
vi.mock("@/server/catalog/read-model", () => ({ readPublicProduct: mocks.read }));
vi.mock("@/server/sanity/preview-read", () => ({ readPreviewProduct: vi.fn() }));
vi.mock("@/server/sanity/preview-session", () => ({ isValidPreviewSession: vi.fn(), PREVIEW_SESSION_COOKIE: "fixture-preview" }));
vi.mock("@/server/config/targets", () => ({ selectComponentTarget: vi.fn() }));

import ProductPage from "../src/app/en/tools/[slug]/page";

const id = productId("prd_ui_fixture");
const base: Extract<PublicProductRead, { status: 200 }> = {
  status: 200, source: "fixture", comparisons: [], metrics: { status: "unavailable" },
  product: {
    product: {
      id, displayName: "Synthetic CMS", routeSlug: "synthetic-cms", categoryIds: [], packageIds: [], repositoryIds: [],
      officialWebsiteUrl: "https://example.invalid/", officialDocsUrl: "https://example.invalid/docs", hostingModels: [], apiStyles: [],
    },
    content: {
      summary: "Editorial content remains readable.", useCases: [], fitsWhen: [], avoidWhen: [], limitations: [], integrationNotes: [],
      criteriaBlocks: [], sources: [], alternativeIds: [], reviewedAt: "2026-10-01T00:00:00.000Z",
      seo: { title: "Synthetic CMS", description: "Synthetic fixture." },
    },
    packages: [], repositories: [],
  },
};
const lastValid: MetricReadValue = {
  productId: id, source: "npm", metric: "downloads_30d", identity: "@fixture/sdk", status: "error", reason: "source_timeout", value: 0,
  lastAttemptAt: utcDateTime("2026-10-07T12:00:00.000Z"), observedAt: utcDateTime("2026-10-03T00:00:00.000Z"),
  fetchedAt: utcDateTime("2026-10-03T08:00:00.000Z"), periodStart: "2026-09-03", periodEnd: "2026-10-02",
  dailySeries: null, freshness: "stale",
};
async function markup() {
  return renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ slug: "synthetic-cms" }) }));
}

describe("independent DP-06 product SSR", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["error", "unknown"] as const)("renders the retained zero, dates, period, stale and distinct attempt for %s", async (status) => {
    mocks.read.mockResolvedValue({ ...base, metrics: { status: "available", values: [{ ...lastValid, status }] } });
    const html = await markup();
    expect(html).toContain(">0</p>");
    expect(html).toContain("Showing the last valid value.");
    expect(html).toContain("stale");
    expect(html).toContain("2026-10-03T00:00:00.000Z");
    expect(html).toContain("2026-10-03T08:00:00.000Z");
    expect(html).toContain("2026-09-03 to 2026-10-02");
    expect(html).toContain("Last collection attempt: 2026-10-07T12:00:00.000Z (UTC)");
    expect(html).toContain("Editorial content remains readable.");
  });

  it("renders editorial content and the metrics failure label on database unavailability", async () => {
    mocks.read.mockResolvedValue(base);
    const html = await markup();
    expect(html).toContain("Synthetic CMS");
    expect(html).toContain("Editorial content remains readable.");
    expect(html).toContain("Package and repository metrics are temporarily unavailable.");
    expect(html).not.toContain("Content temporarily unavailable");
  });
});
