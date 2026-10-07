import { describe, expect, it, vi } from "vitest";
import { buildDevelopmentSeedDocuments, developmentSeedProductIds } from "../src/domain/seed-records";
import { isValidPreviewSession, createPreviewSession, safePreviewRedirect, PREVIEW_SESSION_TTL_SECONDS } from "../src/server/sanity/preview-session";
import { applySeedPlan, planSeedDocuments, type ExistingSeedIdentity } from "../src/server/sanity/seed-writer";
import { projectPublishedMappings } from "../src/server/sanity/published-mapping";
import { parseSeedPublishArgs, planCanonicalSeedWrites, prepareCanonicalSeedDocument } from "../scripts/publish-seed";
import { clearedCookieNames, parseLocalCmsSmokeArgs } from "../scripts/smoke-local-cms";
import { PUBLISHED_CMS_QUERY, projectPublishedCmsRead } from "../src/server/sanity/public-read";
import { packageId, productId, repositoryId } from "../src/domain/ids";
import { computeMappingKey } from "../src/domain/mapping-key";
import { aiReviewDocumentId, categoryContentDocumentId, comparisonContentDocumentId, pageDocumentId, productContentDocumentId, siteSettingsDocumentId } from "../src/domain/cms-document-ids";

describe("public Sanity document IDs", () => {
  it("keeps localized content and site documents on the anonymous root path", () => {
    const ids = [
      productContentDocumentId("prd_sanity"), categoryContentDocumentId("cat_headless_cms"),
      comparisonContentDocumentId("cmp_contentful_sanity_fixture"), pageDocumentId("home"),
      aiReviewDocumentId("prd_sanity"), siteSettingsDocumentId(),
    ];
    expect(ids).toEqual([
      "content_product_prd_sanity_en", "content_category_cat_headless_cms_en",
      "content_comparison_cmp_contentful_sanity_fixture_en", "page_home_en",
      "ai_review_prd_sanity", "siteSettings_default",
    ]);
    expect(ids.every((id) => !id.includes("."))).toBe(true);
  });
});

const sessionSecret = "synthetic-preview-session-secret-value-long-enough";

describe("protected CMS preview sessions", () => {
  it("binds an HttpOnly-ready session to environment and one-hour expiry", () => {
    const now = new Date("2026-10-06T10:00:00.000Z");
    const session = createPreviewSession({ secret: sessionSecret, environment: "development", now });
    expect(PREVIEW_SESSION_TTL_SECONDS).toBe(3600);
    expect(isValidPreviewSession({ value: session, secret: sessionSecret, environment: "development", now })).toBe(true);
    expect(isValidPreviewSession({ value: session, secret: sessionSecret, environment: "production", now })).toBe(false);
    expect(isValidPreviewSession({ value: session, secret: "another-long-secret-value-that-differs", environment: "development", now })).toBe(false);
    expect(isValidPreviewSession({ value: session, secret: sessionSecret, environment: "development", now: new Date(now.getTime() + 60 * 60_000) })).toBe(false);
    expect(isValidPreviewSession({ value: `${session}x`, secret: sessionSecret, environment: "development", now })).toBe(false);
  });

  it("accepts only relative CMS routes without query, fragment, or external redirects", () => {
    expect(safePreviewRedirect("/en/tools/sanity/")).toBe("/en/tools/sanity/");
    expect(safePreviewRedirect("/en/compare/contentful-vs-sanity/")).toBe("/en/compare/contentful-vs-sanity/");
    for (const value of ["https://outside.invalid/", "//outside.invalid/", "/api/preview/enable", "/en/tools/a/?token=hidden", "/en/tools/a/#draft", "/en/tools/a\\/", "/de/tools/sanity/"]) {
      expect(safePreviewRedirect(value)).toBeUndefined();
    }
  });
});

describe("local preview smoke cookie clearing", () => {
  it("recognizes expired and zero-age Set-Cookie headers without logging values", () => {
    const cleared = clearedCookieNames([
      "pkgcompass_preview=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly",
      "__prerender_bypass=; Path=/; Max-Age=0; HttpOnly",
      "unrelated=value; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT",
    ]);
    expect(cleared).toEqual(new Set(["pkgcompass_preview", "__prerender_bypass"]));
  });
});

describe("synthetic Sanity seed", () => {
  const identitiesFor = (documents: readonly { readonly _id: string; readonly _type: string; readonly routeSlug?: unknown; readonly packageName?: unknown; readonly pairKey?: unknown; readonly productId?: unknown; readonly owner?: unknown; readonly name?: unknown }[]): ExistingSeedIdentity[] =>
    documents.map((document) => {
      const slug = document.routeSlug && typeof document.routeSlug === "object" && "current" in document.routeSlug
        ? (document.routeSlug as { readonly current?: unknown }).current
        : undefined;
      const productId = document.productId && typeof document.productId === "object" && "_ref" in document.productId
        ? (document.productId as { readonly _ref?: unknown })._ref
        : undefined;
      return {
        id: `drafts.${document._id}`,
        type: document._type,
        ...(typeof slug === "string" ? { slug } : {}),
        ...(typeof document.packageName === "string" ? { packageName: document.packageName } : {}),
        ...(typeof document.pairKey === "string" ? { pairKey: document.pairKey } : {}),
        ...(typeof productId === "string" ? { productId } : {}),
        ...(typeof document.owner === "string" ? { owner: document.owner } : {}),
        ...(typeof document.name === "string" ? { name: document.name } : {}),
      };
    });

  it("contains synthetic editorial copy and five official package/repository mappings", async () => {
    const documents = await buildDevelopmentSeedDocuments();
    const products = documents.filter((doc) => doc._type === "product");
    const productContent = documents.filter((doc) => doc._type === "productContent");
    const packages = documents.filter((doc) => doc._type === "package");
    const repositories = documents.filter((doc) => doc._type === "repository");
    const comparisons = documents.filter((doc) => doc._type === "comparison");
    expect(products.map(({ _id }) => _id)).toEqual(developmentSeedProductIds);
    expect(productContent).toHaveLength(5);
    expect(packages).toHaveLength(5);
    expect(repositories).toHaveLength(5);
    expect(packages.map(({ packageName }) => packageName)).toEqual([
      "@sanity/client", "contentful", "@strapi/client", "@payloadcms/sdk", "@directus/sdk",
    ]);
    const product = products.find(({ _id }) => _id === "prd_sanity");
    const packageReference = (product?.primaryPackageId as Record<string, unknown> | undefined);
    expect(packageReference).toMatchObject({
      _type: "reference",
      _ref: "pkg_sanity_sdk",
      _weak: true,
      _strengthenOnPublish: { type: "package" },
    });
    expect(JSON.stringify(packages)).not.toContain("@fixture/");
    expect(JSON.stringify(repositories)).not.toContain("fixture-source");
    expect(comparisons).toHaveLength(1);
    expect(JSON.stringify(documents)).toContain("example.invalid");
    expect(JSON.stringify(documents)).toContain("Synthetic development fixture");
    expect(documents.every((doc) => !doc._id.startsWith("drafts."))).toBe(true);
  });

  it("converts only owned weak seed references into strong canonical references", async () => {
    const documents = await buildDevelopmentSeedDocuments();
    const expectedTypes = new Map(documents.map((document) => [document._id, document._type]));
    const published = documents.map((document) => prepareCanonicalSeedDocument(document, expectedTypes));
    const refs: Record<string, unknown>[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (value === null || typeof value !== "object") return;
      const item = value as Record<string, unknown>;
      if (item._type === "reference") refs.push(item);
      Object.values(item).forEach(visit);
    };
    visit(published);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((ref) => typeof ref._ref === "string" && expectedTypes.has(ref._ref) && !("_weak" in ref) && !("_strengthenOnPublish" in ref))).toBe(true);
  });

  it("strictly creates only the eleven public localized documents over the exact seventeen owned entities", async () => {
    const drafts = await buildDevelopmentSeedDocuments();
    const expectedTypes = new Map(drafts.map((document) => [document._id, document._type]));
    const canonical = drafts.map((document) => prepareCanonicalSeedDocument(document, expectedTypes));
    const core = canonical.filter((document) => ["category", "comparison", "package", "product", "repository"].includes(document._type));

    const plan = planCanonicalSeedWrites(canonical, new Map(core.map((document) => [document._id, document])));
    expect(plan.canonicalState).toBe("partial");
    expect(plan.rows.filter(({ operation }) => operation === "skip")).toHaveLength(17);
    expect(plan.toCreate).toHaveLength(11);
    expect(plan.toCreate.every(({ _id }) => !_id.includes("."))).toBe(true);

    const repeat = planCanonicalSeedWrites(canonical, new Map(canonical.map((document) => [document._id, document])));
    expect(repeat.canonicalState).toBe("owned");
    expect(repeat.toCreate).toHaveLength(0);
    expect(repeat.rows.filter(({ operation }) => operation === "skip")).toHaveLength(28);

    expect(() => planCanonicalSeedWrites(canonical, new Map(core.slice(1).map((document) => [document._id, document])))).toThrow();
    expect(() => planCanonicalSeedWrites(canonical, new Map([...core, canonical.find(({ _type }) => _type === "productContent")!].map((document) => [document._id, document])))).toThrow();
    const mismatched = new Map(core.map((document) => [document._id, document]));
    mismatched.set("prd_sanity", { ...mismatched.get("prd_sanity")!, displayName: "changed" });
    expect(() => planCanonicalSeedWrites(canonical, mismatched)).toThrow();
  });

  it("projects a real GROQ-shaped read where optional CMS fields arrive as null", async () => {
    const documents = await buildDevelopmentSeedDocuments();
    const ofType = (type: string) => documents.filter((document) => document._type === type);
    const read = await projectPublishedCmsRead(async (query) => {
      expect(query).toBe(PUBLISHED_CMS_QUERY);
      return {
        categories: ofType("category"),
        categoryContent: [
          ...ofType("categoryContent").map((document) => ({ ...document, _id: `content.category.${(document.categoryId as { _ref: string })._ref}.en`, title: "Legacy private-path synthetic category." })),
          ...ofType("categoryContent"),
        ],
        products: ofType("product"),
        packages: ofType("package"),
        repositories: ofType("repository"),
        productContent: [
          ...ofType("productContent").map((document) => ({ ...document, _id: `content.product.${(document.productId as { _ref: string })._ref}.en`, summary: "Legacy private-path synthetic record.", noPackageReason: null })),
          ...ofType("productContent").map((document) => ({ ...document, noPackageReason: null })),
        ],
        comparisons: ofType("comparison"),
        comparisonContent: [
          ...ofType("comparisonContent").map((document) => ({ ...document, _id: `content.comparison.${(document.comparisonId as { _ref: string })._ref}.en`, title: "Legacy private-path synthetic comparison." })),
          ...ofType("comparisonContent"),
        ],
        aiReviews: [{
          _id: "ai_review.prd_sanity",
          _type: "aiReview",
          productId: { _type: "reference", _ref: "prd_sanity" },
          mappingKey: "private-path-fixture",
          methodologyVersion: "cms-ai-support-v1",
          reviewerLabel: "Synthetic fixture reviewer",
          reviewedAt: "2026-10-06T00:00:00.000Z",
          signals: [],
        }, {
          _id: aiReviewDocumentId("prd_sanity"),
          _type: "aiReview",
          productId: { _type: "reference", _ref: "prd_sanity" },
          mappingKey: "prd_sanity:pkg_sanity_sdk:fixture-version",
          methodologyVersion: "cms-ai-support-v1",
          reviewerLabel: "Fixture reviewer",
          reviewedAt: "2026-10-06T00:00:00.000Z",
          signals: [
            { key: "types", state: "present", kind: null, checkedAt: "2026-10-06T00:00:00.000Z", scope: "primary_package", evidence: [{ sourceUrl: "https://www.sanity.io/docs", officialSourceUrl: null, finding: "Fixture evidence", checkedAt: "2026-10-06T00:00:00.000Z", packageVersion: null, entryPoints: null }] },
            { key: "llmsTxt", state: "unknown", kind: null, checkedAt: null, scope: "official_domain", evidence: [] },
            { key: "mcp", state: "unknown", kind: null, checkedAt: null, scope: "official_domain", evidence: [] },
          ],
        }],
        pages: [
          ...ofType("page").map((document) => ({ ...document, _id: `page.${String(document.pageKey)}.en`, title: "Legacy private-path synthetic page." })),
          ...ofType("page"),
        ],
        siteSettings: documents.find((document) => document._type === "siteSettings"),
        redirects: [],
      };
    });

    expect(read.products).toHaveLength(5);
    expect(read.comparisons).toHaveLength(1);
    expect(read.categories).toHaveLength(1);
    expect(read.categories[0]?.content.title).toBe("Headless CMS development fixture");
    expect(read.comparisons[0]?.content.title).toBe("Synthetic fixture comparison");
    expect(read.pages).toHaveLength(3);
    expect(read.pages.every(({ title }) => title !== "Legacy private-path synthetic page.")).toBe(true);
    expect(read.siteSettings?.footerPageKeys).toEqual(["privacy", "aiMethodology"]);
    const sanity = read.catalog.products.find(({ product }) => product.id === productId("prd_sanity"));
    expect(sanity?.content.summary).toContain("Synthetic development fixture.");
    expect(sanity?.content.noPackageReason).toBeUndefined();
    expect(sanity?.aiReview?.signals[0]).toMatchObject({ key: "types", state: "present" });
    expect(sanity?.aiReview?.signals[0]?.kind).toBeUndefined();
    expect(sanity?.aiReview?.signals[0]?.evidence[0]).not.toHaveProperty("officialSourceUrl");
    expect(sanity?.aiReview?.signals[0]?.evidence[0]).not.toHaveProperty("packageVersion");
    expect(sanity?.aiReview?.signals[0]?.evidence[0]).not.toHaveProperty("entryPoints");
  });

  it("requires development scope and an explicit fixture publication flag for publisher apply", () => {
    expect(parseSeedPublishArgs([
      "--env", "development", "--prepare", "--manifest-path", "manifest.json", "--report-path", "report.json",
    ])).toMatchObject({ environment: "development", mode: "prepare" });
    expect(() => parseSeedPublishArgs([
      "--env", "production", "--apply", "--manifest-path", "manifest.json", "--report-path", "report.json",
      "--confirm-development-fixture-publication",
    ])).toThrow();
    expect(() => parseSeedPublishArgs([
      "--env", "development", "--apply", "--manifest-path", "manifest.json", "--report-path", "report.json",
    ])).toThrow();
  });

  it("requires a development-only runtime smoke and report under the active run artifacts", () => {
    expect(parseLocalCmsSmokeArgs([
      "--env", "development", "--manifest-path", "artifacts/runs/run/cms-publish-manifest.json",
      "--report-path", "artifacts/runs/run/cms-runtime-smoke-final.json",
    ])).toMatchObject({ environment: "development" });
    for (const argv of [
      ["--env", "production", "--manifest-path", "artifacts/runs/run/manifest.json", "--report-path", "artifacts/runs/run/report.json"],
      ["--env", "development", "--manifest-path", "artifacts/runs/run/manifest.json", "--report-path", "../../tmp/report.json"],
      ["--env", "development", "--report-path", "artifacts/runs/run/report.json"],
    ]) expect(() => parseLocalCmsSmokeArgs(argv)).toThrow();
  });

  it("plans create, skip, and identity conflict without modifying existing IDs", async () => {
    const documents = await buildDevelopmentSeedDocuments();
    const existing: ExistingSeedIdentity[] = [
      { id: "drafts.prd_sanity", type: "product", slug: "sanity" },
      { id: "prd_other", type: "product", slug: "contentful" },
    ];
    const plan = planSeedDocuments({ documents, existing });
    expect(plan.find(({ id }) => id === "prd_sanity")).toMatchObject({ operation: "skip", reason: "id_exists" });
    expect(plan.filter(({ id }) => id === "prd_contentful" || id === "pkg_contentful_sdk" || id === "repo_contentful_source" || id === productContentDocumentId("prd_contentful")).every(({ operation }) => operation === "conflict")).toBe(true);
    expect(plan.find(({ id }) => id === "prd_strapi")?.operation).toBe("create");
  });

  it("applies only preflight create rows and leaves repeats idempotent", async () => {
    const documents = await buildDevelopmentSeedDocuments();
    const plan = planSeedDocuments({ documents, existing: [{ id: "prd_sanity", type: "product", slug: "sanity" }] });
    const write = vi.fn(async () => {});
    const applied = await applySeedPlan({ documents, plan, write });
    expect(applied.failed).toBe(0);
    expect(write).toHaveBeenCalledTimes(documents.length - 1);
    const repeatPlan = planSeedDocuments({ documents, existing: identitiesFor(documents) });
    expect(repeatPlan.every(({ operation }) => operation === "skip")).toBe(true);
  });

  it("fails closed across referenced records when an existing seed ID has a different type or identity", async () => {
    const documents = await buildDevelopmentSeedDocuments();
    const plan = planSeedDocuments({
      documents,
      existing: [{ id: "drafts.prd_sanity", type: "product", slug: "editorial-sanity" }],
    });
    const rows = new Map(plan.map((row) => [row.id, row]));
    expect(rows.get("prd_sanity")).toMatchObject({ operation: "conflict", reason: "id_identity_mismatch" });
    expect(rows.get("pkg_sanity_sdk")).toMatchObject({ operation: "conflict", reason: "dependency_conflict" });
    expect(rows.get("repo_sanity_source")).toMatchObject({ operation: "conflict", reason: "dependency_conflict" });
    expect(rows.get("cmp_contentful_sanity_fixture")).toMatchObject({ operation: "conflict", reason: "dependency_conflict" });
    expect(rows.get(pageDocumentId("home"))).toMatchObject({ operation: "conflict", reason: "dependency_conflict" });
    expect(rows.get(siteSettingsDocumentId())?.operation).toBe("create");
  });

  it("conflicts package and repository IDs whose product topology or source identity differs", async () => {
    const documents = await buildDevelopmentSeedDocuments();
    const cases: ExistingSeedIdentity[][] = [
      [{ id: "drafts.pkg_sanity_sdk", type: "package", packageName: "@sanity/client", productId: "prd_other" }],
      [{ id: "drafts.repo_sanity_source", type: "repository", owner: "sanity-io", name: "client", productId: "prd_other" }],
      [{ id: "drafts.repo_sanity_source", type: "repository", owner: "different-owner", name: "client", productId: "prd_sanity" }],
      [{ id: "drafts.repo_sanity_source", type: "repository", owner: "sanity-io", name: "different-repository", productId: "prd_sanity" }],
    ];

    for (const existing of cases) {
      const plan = planSeedDocuments({ documents, existing });
      const rows = new Map(plan.map((row) => [row.id, row]));
      const conflictingId = existing[0]?.type === "package" ? "pkg_sanity_sdk" : "repo_sanity_source";
      expect(rows.get(conflictingId)).toMatchObject({ operation: "conflict", reason: "id_identity_mismatch" });
      expect(rows.get("prd_sanity")).toMatchObject({ operation: "conflict", reason: "dependency_conflict" });
      expect(rows.get(productContentDocumentId("prd_sanity"))).toMatchObject({ operation: "conflict", reason: "dependency_conflict" });
      expect(rows.get("cmp_contentful_sanity_fixture")).toMatchObject({ operation: "conflict", reason: "dependency_conflict" });
    }
  });

  it("stops all later create writes after a mutation failure", async () => {
    const documents = await buildDevelopmentSeedDocuments();
    const plan = planSeedDocuments({ documents, existing: [] });
    const write = vi.fn(async (document: { readonly _id: string }) => {
      if (document._id === "cat_headless_cms") throw new Error("failure details must not enter the result");
    });
    const result = await applySeedPlan({ documents, plan, write });
    expect(result.failed).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.rows.find(({ id }) => id === "cat_headless_cms")).toMatchObject({ operation: "conflict", reason: "write_failed" });
    expect(result.rows.filter(({ id }) => id !== "cat_headless_cms").every(({ operation }) => operation === "conflict")).toBe(true);
  });
});

describe("published Sanity mapping projection", () => {
  it("projects five published CMS mapping identities and official scoped package names", async () => {
    const names = ["sanity", "contentful", "strapi", "payload", "directus"];
    const packageNames: Record<string, string> = {
      sanity: "@sanity/client", contentful: "contentful", strapi: "@strapi/client", payload: "@payloadcms/sdk", directus: "@directus/sdk",
    };
    const owners: Record<string, string> = { sanity: "sanity-io", contentful: "contentful", strapi: "strapi", payload: "payloadcms", directus: "directus" };
    const repositoriesByName: Record<string, string> = { sanity: "client", contentful: "contentful.js", strapi: "client", payload: "payload", directus: "directus" };
    const products = names.map((name) => ({
      _id: `prd_${name}`,
      packageIds: [{ _ref: `pkg_${name}_sdk` }],
      repositoryIds: [{ _ref: `repo_${name}_source` }],
      primaryPackageId: { _ref: `pkg_${name}_sdk` },
      primaryRepositoryId: { _ref: `repo_${name}_source` },
    }));
    const packages = names.map((name) => ({
      _id: `pkg_${name}_sdk`, productId: { _ref: `prd_${name}` }, packageName: packageNames[name], role: "primary_js_sdk",
    }));
    const repositories = names.map((name) => ({
      _id: `repo_${name}_source`, productId: { _ref: `prd_${name}` }, owner: owners[name], name: repositoriesByName[name], role: "primary", officialSourceUrl: `https://github.com/${owners[name]}/${repositoriesByName[name]}`,
    }));
    const raw = {
      products,
      packages,
      repositories,
      productContent: names.map((name) => ({ _id: productContentDocumentId(`prd_${name}`), productId: { _ref: `prd_${name}` }, locale: "en" })),
      aiReviews: [],
    };
    const query = vi.fn(async (groq: string) => { void groq; return raw; });
    const result = await projectPublishedMappings(query);
    expect(result).toHaveLength(5);
    expect(result?.find(({ productId }) => productId === "prd_sanity")?.npmPackageName).toBe("@sanity/client");
    expect(result?.find(({ productId }) => productId === "prd_directus")).toMatchObject({ npmPackageName: "@directus/sdk", primaryPackage: { packageName: "@directus/sdk" } });
    expect(query.mock.calls[0]?.[0]).toContain('_type == "product"');
  });

  it("uses the published types evidence package version in the shared mapping key", async () => {
    const pid = productId("prd_sanity");
    const pkg = packageId("pkg_sanity_sdk");
    const repo = repositoryId("repo_sanity_source");
    const version = "1.2.3";
    const expected = await computeMappingKey({ productId: pid, primaryPackage: { id: pkg, packageName: "@sanity/client" }, primaryRepository: { id: repo, owner: "sanity-io", name: "client" }, sdkPackageVersion: version });
    const result = await projectPublishedMappings(async () => ({
      products: [{ _id: pid, packageIds: [{ _ref: pkg }], repositoryIds: [{ _ref: repo }], primaryPackageId: { _ref: pkg }, primaryRepositoryId: { _ref: repo } }],
      packages: [{ _id: pkg, productId: { _ref: pid }, packageName: "@sanity/client", role: "primary_js_sdk" }],
      repositories: [{ _id: repo, productId: { _ref: pid }, owner: "sanity-io", name: "client", role: "primary", officialSourceUrl: "https://github.com/sanity-io/client" }],
      productContent: [{ _id: productContentDocumentId(pid), productId: { _ref: pid }, locale: "en" }],
      aiReviews: [{ _id: aiReviewDocumentId(pid), productId: { _ref: pid }, signals: [{ key: "types", evidence: [{ packageVersion: version }] }] }],
    }));
    expect(result?.[0]?.mappingKey).toBe(expected);
    expect(result?.[0]?.sdkPackageVersion).toBe(version);
  });
});
