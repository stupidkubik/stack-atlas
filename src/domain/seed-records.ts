import { pairKey, packageId, productId, repositoryId } from "./ids";
import { categoryContentDocumentId, comparisonContentDocumentId, pageDocumentId, productContentDocumentId, siteSettingsDocumentId } from "./cms-document-ids";

export interface SeedDocument extends Record<string, unknown> {
  readonly _id: string;
  readonly _type: string;
}

const CATEGORY_ID = "cat_headless_cms";
const FIXTURE_SOURCE = "https://example.invalid/pkgcompass-development-fixture";
const REVIEWED_AT = "2026-10-06T00:00:00.000Z";
const CMS = [
  {
    slug: "sanity", name: "Sanity", packageName: "@sanity/client", packageSource: "https://github.com/sanity-io/client",
    repositoryOwner: "sanity-io", repositoryName: "client", repositorySource: "https://github.com/sanity-io/client",
    website: "https://www.sanity.io", docs: "https://www.sanity.io/docs",
  },
  {
    slug: "contentful", name: "Contentful", packageName: "contentful", packageSource: "https://github.com/contentful/contentful.js",
    repositoryOwner: "contentful", repositoryName: "contentful.js", repositorySource: "https://github.com/contentful/contentful.js",
    website: "https://www.contentful.com", docs: "https://www.contentful.com/developers/docs/javascript/",
  },
  {
    slug: "strapi", name: "Strapi", packageName: "@strapi/client", packageSource: "https://github.com/strapi/client",
    repositoryOwner: "strapi", repositoryName: "client", repositorySource: "https://github.com/strapi/client",
    website: "https://strapi.io", docs: "https://docs.strapi.io/",
  },
  {
    slug: "payload", name: "Payload", packageName: "@payloadcms/sdk", packageSource: "https://payloadcms.com/docs/rest-api/overview",
    repositoryOwner: "payloadcms", repositoryName: "payload", repositorySource: "https://github.com/payloadcms/payload",
    website: "https://payloadcms.com", docs: "https://payloadcms.com/docs/rest-api/overview",
  },
  {
    slug: "directus", name: "Directus", packageName: "@directus/sdk", packageSource: "https://directus.com/docs/guides/connect/sdk",
    repositoryOwner: "directus", repositoryName: "directus", repositorySource: "https://github.com/directus/directus",
    website: "https://directus.com", docs: "https://directus.com/docs/guides/connect/sdk",
  },
] as const;

function ref(id: string, targetType: string) {
  return {
    _type: "reference",
    _ref: id,
    _weak: true,
    _strengthenOnPublish: { type: targetType },
  };
}
function block(text: string, key = "fixture_block") {
  return [{ _type: "block", _key: key, style: "normal", children: [{ _type: "span", _key: `${key}_span`, text, marks: [] }], markDefs: [] }];
}
function source(key: string) {
  return { _key: `source_${key}`, key, title: "Synthetic fixture source (not a factual citation)", url: `${FIXTURE_SOURCE}/${key}`, accessedAt: REVIEWED_AT };
}
function keyed(key: string, text: string) { return { _key: `item_${key}`, key, text }; }

export async function buildDevelopmentSeedDocuments(): Promise<readonly SeedDocument[]> {
  const docs: SeedDocument[] = [
    {
      _id: CATEGORY_ID,
      _type: "category",
      routeSlug: { _type: "slug", current: "headless-cms" },
      displayOrder: 0,
    },
    {
      _id: categoryContentDocumentId(CATEGORY_ID),
      _type: "categoryContent",
      categoryId: ref(CATEGORY_ID, "category"),
      locale: "en",
      title: "Headless CMS development fixture",
      intro: block("Synthetic development content for checking the public CMS path. Replace this entire record before publication.", "category_intro"),
      seo: { title: "Headless CMS fixture", description: "Synthetic development content for route and schema checks." },
    },
  ];

  for (const cms of CMS) {
    const product = productId(`prd_${cms.slug}`);
    const pkg = packageId(`pkg_${cms.slug}_sdk`);
    const repo = repositoryId(`repo_${cms.slug}_source`);
    const packageRef = ref(pkg, "package");
    const repositoryRef = ref(repo, "repository");
    docs.push({
      _id: product,
      _type: "product",
      displayName: cms.name,
      routeSlug: { _type: "slug", current: cms.slug },
      categoryIds: [ref(CATEGORY_ID, "category")],
      officialWebsiteUrl: cms.website,
      officialDocsUrl: cms.docs,
      hostingModels: [],
      apiStyles: [],
      packageIds: [packageRef],
      repositoryIds: [repositoryRef],
      primaryPackageId: packageRef,
      primaryRepositoryId: repositoryRef,
    });
    docs.push({
      _id: pkg,
      _type: "package",
      productId: ref(product, "product"),
      packageName: cms.packageName,
      role: "primary_js_sdk",
      officialSourceUrl: cms.packageSource,
    });
    docs.push({
      _id: repo,
      _type: "repository",
      productId: ref(product, "product"),
      owner: cms.repositoryOwner,
      name: cms.repositoryName,
      scope: "product",
      role: "primary",
      officialSourceUrl: cms.repositorySource,
    });
    const sourceKey = "synthetic_fixture";
    docs.push({
      _id: productContentDocumentId(product),
      _type: "productContent",
      productId: ref(product, "product"),
      locale: "en",
      summary: "Synthetic development fixture. This text contains no product evaluation and must be replaced before publication.",
      useCases: [keyed("fixture_scope", "Synthetic fixture only; no supported use case is asserted.")],
      fitsWhen: [keyed("fixture_scope", "Use this record only to test the CMS document path.")],
      avoidWhen: [keyed("fixture_scope", "Do not treat fixture content as a product recommendation.")],
      limitations: [keyed("fixture_scope", "Editorial claims are synthetic. Package and repository mappings point to official sources but are provided only as development fixtures.")],
      integrationNotes: block("Synthetic development fixture; no integration behavior is asserted.", "integration_fixture"),
      criteriaBlocks: ["deployment", "content_model", "editorial_workflow", "js_ts", "localization_access", "cost_limits", "agent_support"].map((key) => ({
        _key: `criterion_${key}`,
        key,
        body: block("Synthetic fixture; replace with sourced editorial evidence before publication.", `body_${key}`),
        sourceKeys: [sourceKey],
      })),
      sources: [source(sourceKey)],
      alternativeIds: [],
      reviewedAt: REVIEWED_AT,
      seo: { title: `${cms.name} fixture`, description: "Synthetic development content; not a product review." },
    });
  }

  const contentfulId = productId("prd_contentful");
  const sanityId = productId("prd_sanity");
  const comparisonId = "cmp_contentful_sanity_fixture";
  const canonicalPair = pairKey([contentfulId, sanityId]);
  docs.push({
    _id: comparisonId,
    _type: "comparison",
    productIds: [ref(contentfulId, "product"), ref(sanityId, "product")],
    pairKey: canonicalPair,
    categoryId: ref(CATEGORY_ID, "category"),
    displayOrder: [ref(sanityId, "product"), ref(contentfulId, "product")],
  }, {
    _id: comparisonContentDocumentId(comparisonId),
    _type: "comparisonContent",
    comparisonId: ref(comparisonId, "comparison"),
    locale: "en",
    title: "Synthetic fixture comparison",
    taskContext: block("Synthetic comparison fixture for verifying route, reference, and table behavior.", "comparison_task"),
    criteria: ["fixture_setup", "fixture_review", "fixture_sources"].map((key) => ({
      _key: `comparison_${key}`,
      key,
      label: key.replaceAll("_", " "),
      description: "Synthetic fixture criterion; no factual distinction is asserted.",
      cells: [contentfulId, sanityId].map((id) => ({ _key: `cell_${key}_${id}`, productId: ref(id, "product"), text: "Synthetic fixture; replace with sourced editorial evidence.", sourceKeys: ["comparison_fixture"] })),
      importanceNote: "Fixture only.",
    })),
    choiceGuidance: [contentfulId, sanityId].map((id) => ({ _key: `choice_${id}`, productId: ref(id, "product"), conditions: [keyed("fixture_scope", "No selection advice is asserted by this fixture.")] })),
    limitations: [keyed("fixture_scope", "This record is synthetic and must not be published as editorial content.")],
    verdict: block("No editorial verdict is asserted by this synthetic fixture.", "comparison_verdict"),
    sources: [source("comparison_fixture")],
    reviewedAt: REVIEWED_AT,
    seo: { title: "Synthetic comparison fixture", description: "Synthetic development data for route and schema checks." },
    indexingRequested: false,
    disclosure: "Synthetic development fixture; no comparison claim is made.",
  });

  const ids = CMS.map(({ slug }) => productId(`prd_${slug}`));
  docs.push({
    _id: pageDocumentId("home"),
    _type: "page",
    pageKey: "home",
    locale: "en",
    title: "PkgCompass CMS development fixture",
    sections: [
      { _key: "home_hero", _type: "heroSection", sectionKey: "home_hero", heading: "Synthetic CMS fixture", body: block("Development data for checking Studio publication and public reads. Replace before publication.", "home_intro"), primaryCategory: ref(CATEGORY_ID, "category"), secondaryRequestLabel: "Request a shortlist" },
      { _key: "home_products", _type: "featuredProductsSection", sectionKey: "home_products", heading: "Fixture CMS records", productIds: ids.map((id) => ref(id, "product")) },
      { _key: "home_comparison", _type: "featuredComparisonsSection", sectionKey: "home_comparison", heading: "Fixture comparison", comparisonIds: [ref(comparisonId, "comparison")] },
      { _key: "home_methodology", _type: "methodologyTeaserSection", sectionKey: "home_methodology", heading: "AI readiness methodology", body: block("Synthetic fixture section for checking linked page content.", "home_methodology_text") },
    ],
    seo: { title: "PkgCompass CMS fixture", description: "Synthetic development data for the CMS prototype." },
  }, {
    _id: pageDocumentId("aiMethodology"),
    _type: "page",
    pageKey: "aiMethodology",
    locale: "en",
    title: "AI readiness methodology fixture",
    sections: [{ _key: "methodology_text", _type: "richTextSection", sectionKey: "methodology_text", heading: "Synthetic fixture", body: block("Replace with approved methodology copy before publication.", "methodology_body") }],
    seo: { title: "AI methodology fixture", description: "Synthetic development data for methodology route checks." },
  }, {
    _id: pageDocumentId("privacy"),
    _type: "page",
    pageKey: "privacy",
    locale: "en",
    title: "Privacy fixture",
    sections: [{ _key: "privacy_text", _type: "richTextSection", sectionKey: "privacy_text", heading: "Synthetic fixture", body: block("Replace with approved privacy copy before publication.", "privacy_body") }],
    seo: { title: "Privacy fixture", description: "Synthetic development data for privacy route checks." },
  }, {
    _id: siteSettingsDocumentId(),
    _type: "siteSettings",
    siteName: "PkgCompass",
    defaultLocale: "en",
    activeLocales: ["en"],
    navigation: [
      { _key: "nav_category", key: "cms_category", label: "CMS guides", targetType: "category", categoryId: ref(CATEGORY_ID, "category") },
      { _key: "nav_methodology", key: "ai_methodology", label: "AI readiness", targetType: "aiMethodology" },
      { _key: "nav_request", key: "request_shortlist", label: "Request a shortlist", targetType: "requestShortlist" },
    ],
    footerLinks: [ref(pageDocumentId("privacy"), "page"), ref(pageDocumentId("aiMethodology"), "page")],
  });

  if (ids.length !== 5) throw new Error("seed_fixture_definition_invalid");
  return docs;
}

export const developmentSeedProductIds = CMS.map(({ slug }) => `prd_${slug}` as const);
