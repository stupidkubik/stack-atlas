import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDevelopmentSeedDocuments } from "../src/domain/seed-records";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), redirect: vi.fn((location: string) => { throw new Error(`308:${location}`); }) }));
vi.mock("@sanity/client", () => ({ createClient: () => ({ fetch: mocks.fetch }) }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ draftMode: async () => ({ isEnabled: false }) }));
vi.mock("next/navigation", () => ({ permanentRedirect: mocks.redirect, notFound: () => { throw new Error("404"); } }));
vi.mock("../src/server/config/targets", () => ({ selectComponentTarget: (component: string) => component === "content"
  ? { mode: "live", settings: { SANITY_PROJECT_ID: "synthetic", SANITY_DATASET: "development", SANITY_API_VERSION: "2026-10-06" } }
  : { mode: "fixture" } }));
import { getPublishedCatalogRead, getPublishedComparisonRouteContext } from "../src/server/sanity/public-read";
import { readPublicProduct } from "../src/server/catalog/read-model";
import ProductPage, { generateMetadata as productMetadata } from "../src/app/en/tools/[slug]/page";
import ComparisonPage, { generateMetadata as comparisonMetadata } from "../src/app/en/compare/[pair]/page";

let raw: Record<string, unknown>;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ENV", "fixture");
  const docs = await buildDevelopmentSeedDocuments();
  const of = (type: string) => docs.filter(doc => doc._type === type);
  raw = { categories: of("category"), categoryContent: of("categoryContent"), products: of("product"),
    packages: of("package"), repositories: of("repository"), productContent: of("productContent"),
    comparisons: of("comparison"), comparisonContent: of("comparisonContent"), pages: of("page"),
    aiReviews: [], siteSettings: of("siteSettings")[0], redirects: [] };
  mocks.fetch.mockImplementation(async () => raw);
});
const redirect = (sourcePath: string, targetPath: string) => ({ _id: "redirect_synthetic", _type: "redirect", sourcePath, targetPath, statusCode: 308 });
afterEach(() => vi.unstubAllEnvs());

describe("published rename HTTP routing", () => {
  it("uses the validated same cached projection for old product page and metadata 308", async () => {
    raw.redirects = [redirect("/en/tools/old-sanity/", "/en/tools/sanity/")];
    await expect(readPublicProduct("old-sanity")).resolves.toEqual({ status: 308, location: "/en/tools/sanity/" });
    const props = { params: Promise.resolve({ slug: "old-sanity" }) };
    await expect(ProductPage(props)).rejects.toThrow("308:/en/tools/sanity/");
    await expect(productMetadata(props)).rejects.toThrow("308:/en/tools/sanity/");
    expect(mocks.redirect).toHaveBeenCalledTimes(2);
  });

  it("serves the destination with its canonical and leaves unknown old spellings missing", async () => {
    raw.redirects = [redirect("/en/tools/old-sanity/", "/en/tools/sanity/")];
    const props = { params: Promise.resolve({ slug: "sanity" }) };
    expect(renderToStaticMarkup(await ProductPage(props))).toContain("Sanity");
    expect((await productMetadata(props)).alternates?.canonical).toBe("http://127.0.0.1:3000/en/tools/sanity/");
    await expect(readPublicProduct("old-sanity-extra")).resolves.toEqual({ status: 404 });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("resolves a stored old comparison path before looking up renamed product slugs", async () => {
    raw.redirects = [redirect("/en/compare/contentful-vs-old-sanity/", "/en/compare/contentful-vs-sanity/")];
    await expect(getPublishedComparisonRouteContext("contentful-vs-old-sanity")).resolves.toEqual({ kind: "redirect", location: "/en/compare/contentful-vs-sanity/" });
    const props = { params: Promise.resolve({ pair: "contentful-vs-old-sanity" }) };
    await expect(ComparisonPage(props)).rejects.toThrow("308:/en/compare/contentful-vs-sanity/");
    await expect(comparisonMetadata(props)).rejects.toThrow("308:/en/compare/contentful-vs-sanity/");
    expect((await comparisonMetadata({ params: Promise.resolve({ pair: "contentful-vs-sanity" }) })).alternates?.canonical)
      .toBe("http://127.0.0.1:3000/en/compare/contentful-vs-sanity/");
  });

  it("drops chains, external/unready targets, duplicate sources and a redirect shadowing a current route", async () => {
    raw.redirects = [
      redirect("/en/tools/chain-a/", "/en/tools/chain-b/"), redirect("/en/tools/chain-b/", "/en/tools/sanity/"),
      redirect("/en/tools/external/", "https://outside.invalid/"), redirect("/en/tools/unready/", "/en/tools/unpublished/"),
      redirect("/en/tools/duplicate/", "/en/tools/sanity/"), redirect("/en/tools/duplicate/", "/en/tools/contentful/"),
      redirect("/en/tools/sanity/", "/en/tools/contentful/"),
    ];
    const result = await getPublishedCatalogRead();
    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error("missing fixture");
    expect(result.model.redirects).toEqual([]);
    for (const slug of ["chain-a", "chain-b", "external", "unready", "duplicate"]) {
      await expect(readPublicProduct(slug)).resolves.toEqual({ status: 404 });
    }
    expect((await productMetadata({ params: Promise.resolve({ slug: "sanity" }) })).alternates?.canonical)
      .toBe("http://127.0.0.1:3000/en/tools/sanity/");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
