import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDevelopmentSeedDocuments } from "../src/domain/seed-records";
import { JsonLd, serializeJsonLd } from "../src/features/content/json-ld";
import { PortableText } from "../src/features/content/portable-text";
import { categoryPath, methodologyPath } from "../src/domain/public-urls";
import type { CmsPublicReadModel } from "../src/server/sanity/public-read";

const mocks = vi.hoisted(() => ({ read: vi.fn(), comparison: vi.fn(), notFound: vi.fn(() => { throw new Error("fixture-not-found"); }) }));
vi.mock("@/server/sanity/public-read", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/server/sanity/public-read")>(), getPublishedCatalogRead: mocks.read,
  getPublishedComparisonRouteContext: mocks.comparison,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
import { projectPublishedCmsRead } from "../src/server/sanity/public-read";
import CategoryPage, { generateMetadata as categoryMetadata } from "../src/app/en/categories/[slug]/page";
import MethodologyPage, { generateMetadata as methodologyMetadata } from "../src/app/en/methodology/ai-readiness/page";
import HomePage from "../src/app/en/page";
import ComparisonPage, { generateMetadata as comparisonMetadata } from "../src/app/en/compare/[pair]/page";
import { publicPageMetadata } from "../src/server/seo/public-metadata";

let model: CmsPublicReadModel;
beforeAll(async () => {
  const docs = await buildDevelopmentSeedDocuments();
  const ofType = (type: string) => docs.filter((doc) => doc._type === type);
  model = await projectPublishedCmsRead(async () => ({ categories: ofType("category"), categoryContent: ofType("categoryContent"),
    products: ofType("product"), packages: ofType("package"), repositories: ofType("repository"), productContent: ofType("productContent"),
    comparisons: ofType("comparison"), comparisonContent: ofType("comparisonContent"), aiReviews: [], pages: ofType("page"),
    redirects: [], siteSettings: ofType("siteSettings")[0] }));
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ENV", "fixture");
  mocks.read.mockResolvedValue({ status: 200, source: "fixture", model });
  mocks.comparison.mockResolvedValue({ kind: "published", comparison: model.comparisons[0] });
});
afterEach(() => vi.unstubAllEnvs());
function schemas(html: string) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((match) => JSON.parse(match[1]));
}

describe("CW-07 published prototype routes", () => {
  it("renders only the selected category's published products and matches its visible ItemList", async () => {
    const category = model.categories[0];
    const included = model.products.filter(({ product }) => product.displayName !== "Strapi");
    mocks.read.mockResolvedValue({ status: 200, source: "fixture", model: { ...model,
      products: model.products.map((item) => item.product.displayName === "Strapi" ? { ...item, product: { ...item.product, categoryIds: ["cat_elsewhere"] } } : item) } });
    const html = renderToStaticMarkup(await CategoryPage({ params: Promise.resolve({ slug: category.routeSlug }) }));
    expect(html).toContain(category.content.title);
    expect(html).not.toContain("/en/tools/strapi/");
    const data = schemas(html);
    expect(data.find((entry) => entry["@type"] === "CollectionPage").url).toBe(`http://127.0.0.1:3000${categoryPath(category.routeSlug)}`);
    const list = data.find((entry) => entry["@type"] === "ItemList").itemListElement;
    expect(list.map((entry: { name: string }) => entry.name)).toEqual(included.map(({ product }) => product.displayName).toSorted());
    expect(list).toHaveLength(included.length);
    expect(data.some((entry) => entry["@type"] === "BreadcrumbList")).toBe(true);
    const metadata = await categoryMetadata({ params: Promise.resolve({ slug: category.routeSlug }) });
    expect(metadata.openGraph).toMatchObject({ url: metadata.alternates?.canonical, title: category.content.seo.title });
  });

  it("returns notFound for unknown category and unpublished methodology, without canonical or schema", async () => {
    await expect(CategoryPage({ params: Promise.resolve({ slug: "unknown-category" }) })).rejects.toThrow("fixture-not-found");
    const category = await categoryMetadata({ params: Promise.resolve({ slug: "unknown-category" }) });
    expect(category.alternates).toBeUndefined();
    mocks.read.mockResolvedValue({ status: 200, source: "fixture", model: { ...model, pages: model.pages.filter((page) => page.pageKey !== "aiMethodology") } });
    await expect(MethodologyPage()).rejects.toThrow("fixture-not-found");
    expect((await methodologyMetadata()).alternates).toBeUndefined();
  });

  it("keeps CMS unavailability distinct from missing content and emits no false canonical or structured data", async () => {
    mocks.read.mockResolvedValue({ status: 503, code: "cms_unavailable" });
    const html = renderToStaticMarkup(await MethodologyPage());
    expect(html).toContain("Content temporarily unavailable");
    expect(schemas(html)).toHaveLength(0);
    expect((await methodologyMetadata()).alternates).toBeUndefined();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("renders approved methodology copy and a transparent example without inventing authorship or dates", async () => {
    const page = model.pages.find((item) => item.pageKey === "aiMethodology")!;
    mocks.read.mockResolvedValue({ status: 200, source: "fixture", model: { ...model, pages: [{ ...page, sections: [...page.sections,
      { _type: "aiScoreExample", sectionKey: "example", methodologyVersion: "cms-ai-support-v1", typesKind: "external", llmsTxtPresent: true, mcpPresent: true }] }] } });
    const html = renderToStaticMarkup(await MethodologyPage());
    expect(html).toContain("Replace with approved methodology copy before publication.");
    expect(html).toContain("81 / 100");
    expect(html).toContain("cms-ai-support-v1");
    const pageSchema = schemas(html).find((entry) => entry["@type"] === "WebPage");
    expect(pageSchema.url).toBe(`http://127.0.0.1:3000${methodologyPath()}`);
    expect(pageSchema.author).toBeUndefined();
    expect(pageSchema.dateModified).toBeUndefined();
  });

  it("home respects authored featured IDs instead of showing every ready product", async () => {
    const page = model.pages.find((item) => item.pageKey === "home")!;
    mocks.read.mockResolvedValue({ status: 200, source: "fixture", model: { ...model, pages: [{ ...page, sections: page.sections.map((section) =>
      section._type === "featuredProductsSection" ? { ...section, productIds: ["prd_sanity"] } : section) }] } });
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('href="/en/tools/sanity');
    expect(html).not.toContain('href="/en/tools/contentful');
    expect(html).not.toContain('href="/en/tools/directus');
    expect(schemas(html).some((entry) => entry["@type"] === "WebSite")).toBe(true);
  });

  it("comparison shares canonical and OG from stable product IDs and emits only supported visible facts", async () => {
    const params = Promise.resolve({ pair: "contentful-vs-sanity" });
    const html = renderToStaticMarkup(await ComparisonPage({ params }));
    expect(html).toContain(model.comparisons[0].content.title);
    const metadata = await comparisonMetadata({ params });
    expect(metadata.alternates?.canonical).toBe("http://127.0.0.1:3000/en/compare/contentful-vs-sanity/");
    expect(metadata.openGraph).toMatchObject({ url: metadata.alternates?.canonical });
    const page = schemas(html).find((entry) => entry["@type"] === "WebPage");
    expect(page.url).toBe(metadata.alternates?.canonical);
    expect(page.author).toBeUndefined();
    expect(page.aggregateRating).toBeUndefined();
  });

  it("SEO uses the owner-configured production origin and keeps nonindexing published pages noindex", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SITE_URL", "https://catalog.example.invalid");
    vi.stubEnv("VERCEL_URL", "untrusted-preview.vercel.app");
    const normal = publicPageMetadata({ title: "Visible title", description: "Visible description", path: methodologyPath() });
    expect(normal.alternates?.canonical).toBe("https://catalog.example.invalid/en/methodology/ai-readiness/");
    expect(normal.robots).toMatchObject({ index: true, follow: true });
    expect(publicPageMetadata({ title: "Visible title", description: "Visible description", path: methodologyPath(), index: false }).robots)
      .toMatchObject({ index: false, follow: true });
  });
});

describe("CW-07 CMS text rendering boundaries", () => {
  it("keeps malicious CMS text inside a parseable JSON-LD script", () => {
    const malicious = "</script><script>alert('synthetic')</script>&\u2028";
    const value = { "@context": "https://schema.org", "@type": "WebPage", name: malicious };
    const encoded = serializeJsonLd(value);
    expect(encoded).not.toContain("</script>");
    expect(JSON.parse(encoded)).toEqual(value);
    const html = renderToStaticMarkup(<JsonLd value={value} />);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(schemas(html)[0].name).toBe(malicious);
  });

  it("renders formatting and list text while rejecting executable link protocols and raw HTML", () => {
    const html = renderToStaticMarkup(<PortableText value={[
      { _type: "block", _key: "intro", style: "normal", children: [{ _type: "span", text: "<script>synthetic</script>", marks: ["strong", "bad"] }],
        markDefs: [{ _type: "safeLink", _key: "bad", href: "javascript:alert(1)" }] },
      { _type: "block", _key: "list", style: "normal", listItem: "bullet", children: [{ _type: "span", text: "Visible source", marks: ["good"] }],
        markDefs: [{ _type: "safeLink", _key: "good", href: "https://example.invalid/docs" }] },
    ]} />);
    expect(html).toContain("<strong>&lt;script&gt;synthetic&lt;/script&gt;</strong>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<ul");
    expect(html).toContain('href="https://example.invalid/docs"');
  });
});
