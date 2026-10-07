import "server-only";

import {
  categoryId,
  comparisonId,
  packageId,
  pairKey,
  productId,
  repositoryId,
} from "../../domain/ids";
import type {
  AiReviewProjection,
  AiSignal,
  CatalogSnapshot,
  Product,
  ProductContentRevision,
} from "../../domain/catalog";
import { toPublishedCatalog } from "../../domain/catalog";
import { aiReviewDocumentId, comparisonContentDocumentId, productContentDocumentId } from "../../domain/cms-document-ids";
import { createCatalogIdAllowlist } from "../../domain/measurement";
import { utcDateTime } from "../../domain/utc";

export const FIXTURE_LABEL = "Synthetic fixtures only; not vendor verification.";
export const FIXTURE_CATEGORY_ID = categoryId("cat_headless_cms");

const sanityId = productId("prd_sanity");
const contentfulId = productId("prd_contentful");
const strapiId = productId("prd_strapi");
const payloadId = productId("prd_payload");
const directusId = productId("prd_directus");
const draftMarkerId = productId("prd_synthetic_draft_marker");

const products: Product[] = [
  {
    id: sanityId,
    displayName: "Sanity (synthetic fixture)",
    routeSlug: "fixture-sanity",
    categoryIds: [FIXTURE_CATEGORY_ID],
    packageIds: [packageId("pkg_sanity_sdk"), packageId("pkg_sanity_node")],
    repositoryIds: [repositoryId("repo_sanity_monorepo")],
    primaryPackageId: packageId("pkg_sanity_sdk"),
    primaryRepositoryId: repositoryId("repo_sanity_monorepo"),
    state: "published",
  },
  {
    id: contentfulId,
    displayName: "Contentful (synthetic fixture)",
    routeSlug: "fixture-contentful",
    categoryIds: [FIXTURE_CATEGORY_ID],
    packageIds: [packageId("pkg_contentful_sdk")],
    repositoryIds: [repositoryId("repo_contentful_monorepo")],
    primaryPackageId: packageId("pkg_contentful_sdk"),
    primaryRepositoryId: repositoryId("repo_contentful_monorepo"),
    state: "published",
  },
  {
    id: strapiId,
    displayName: "Strapi (synthetic fixture)",
    routeSlug: "fixture-strapi",
    categoryIds: [FIXTURE_CATEGORY_ID],
    packageIds: [packageId("pkg_strapi_sdk")],
    repositoryIds: [repositoryId("repo_strapi_fixture")],
    primaryPackageId: packageId("pkg_strapi_sdk"),
    primaryRepositoryId: repositoryId("repo_strapi_fixture"),
    state: "published",
  },
  {
    id: payloadId,
    displayName: "Payload (synthetic fixture)",
    routeSlug: "fixture-payload",
    categoryIds: [FIXTURE_CATEGORY_ID],
    packageIds: [packageId("pkg_payload_sdk")],
    repositoryIds: [repositoryId("repo_payload_fixture")],
    primaryPackageId: packageId("pkg_payload_sdk"),
    primaryRepositoryId: repositoryId("repo_payload_fixture"),
    state: "published",
  },
  {
    id: directusId,
    displayName: "Directus (synthetic fixture)",
    routeSlug: "fixture-directus",
    categoryIds: [FIXTURE_CATEGORY_ID],
    packageIds: [],
    repositoryIds: [repositoryId("repo_directus_fixture")],
    primaryRepositoryId: repositoryId("repo_directus_fixture"),
    state: "published",
  },
  {
    id: draftMarkerId,
    displayName: "Synthetic draft marker",
    routeSlug: "synthetic-draft-marker",
    categoryIds: [FIXTURE_CATEGORY_ID],
    packageIds: [],
    repositoryIds: [],
    state: "draft",
  },
];

const publicContent = (id: ReturnType<typeof productId>, name: string): ProductContentRevision => ({
  documentId: productContentDocumentId(id),
  productId: id,
  locale: "en",
  state: "published",
  summary: `${name}: synthetic fixture summary; no real-world product claim is made.`,
});

function evidence(key: string, index: number) {
  const checkedAt = utcDateTime("2026-10-01T12:00:00.000Z");
  return {
    sourceUrl: `https://example.invalid/fixture/ai/${key}`,
    officialSourceUrl: `https://example.invalid/fixture/official/${key}`,
    finding: "Synthetic fixture evidence; not a real CMS review.",
    checkedAt,
    packageVersion: index === 0 ? "fixture-sdk-1.0.0" : undefined,
    entryPoints: index === 0 ? ["fixture-entry"] : undefined,
  };
}

function signal(
  key: AiSignal["key"],
  state: AiSignal["state"],
  index: number,
): AiSignal {
  return {
    key,
    state,
    scope: "Synthetic fixture scope only.",
    checkedAt: utcDateTime("2026-10-01T12:00:00.000Z"),
    evidence: [evidence(key, index)],
    ...(key === "types" ? { kind: state === "present" ? "bundled" : "none" } : {}),
  };
}

export const completeAiReviewFixture: AiReviewProjection = {
  id: aiReviewDocumentId(sanityId),
  productId: sanityId,
  mappingKey: "fixture:@fixture/sanity-sdk",
  methodologyVersion: "fixture-methodology-v0",
  reviewerLabel: "Synthetic fixture reviewer",
  signals: [signal("types", "present", 0), signal("llmsTxt", "present", 1), signal("mcp", "present", 2)],
  reviewedAt: utcDateTime("2026-10-01T12:00:00.000Z"),
  state: "published",
};

export const incompleteAiReviewFixture: AiReviewProjection = {
  id: aiReviewDocumentId(contentfulId),
  productId: contentfulId,
  mappingKey: "fixture:@fixture/contentful-sdk",
  methodologyVersion: "fixture-methodology-v0",
  reviewerLabel: "Synthetic fixture reviewer",
  signals: [signal("types", "present", 0), signal("llmsTxt", "unknown", 1), signal("mcp", "error", 2)],
  reviewedAt: utcDateTime("2026-10-01T12:00:00.000Z"),
  state: "published",
};

export const fixtureSnapshot: CatalogSnapshot = {
  products,
  productContent: [
    publicContent(sanityId, "Sanity"),
    publicContent(contentfulId, "Contentful"),
    publicContent(strapiId, "Strapi"),
    publicContent(payloadId, "Payload"),
    {
      ...publicContent(directusId, "Directus"),
      noPackageReason: "Synthetic fixture: no SDK mapping is provided.",
    },
    {
      documentId: `drafts.${productContentDocumentId(draftMarkerId)}`,
      productId: draftMarkerId,
      locale: "en",
      state: "draft",
      summary: "Synthetic unpublished fixture marker.",
    },
  ],
  packages: [
    { id: packageId("pkg_sanity_sdk"), productId: sanityId, packageName: "@fixture/sanity-sdk", role: "primary_js_sdk", officialSourceUrl: "https://example.invalid/fixture/npm/sanity-sdk" },
    { id: packageId("pkg_sanity_node"), productId: sanityId, packageName: "@fixture/sanity-node", role: "additional", officialSourceUrl: "https://example.invalid/fixture/npm/sanity-node" },
    { id: packageId("pkg_contentful_sdk"), productId: contentfulId, packageName: "@fixture/contentful-sdk", role: "primary_js_sdk", officialSourceUrl: "https://example.invalid/fixture/npm/contentful-sdk" },
    { id: packageId("pkg_strapi_sdk"), productId: strapiId, packageName: "@fixture/strapi-sdk", role: "primary_js_sdk", officialSourceUrl: "https://example.invalid/fixture/npm/strapi-sdk" },
    { id: packageId("pkg_payload_sdk"), productId: payloadId, packageName: "@fixture/payload-sdk", role: "primary_js_sdk", officialSourceUrl: "https://example.invalid/fixture/npm/payload-sdk" },
  ],
  repositories: [
    { id: repositoryId("repo_sanity_monorepo"), productId: sanityId, owner: "fixture-source", name: "sanity-monorepo", scope: "product", role: "primary", officialSourceUrl: "https://example.invalid/fixture-source/sanity-monorepo" },
    { id: repositoryId("repo_contentful_monorepo"), productId: contentfulId, owner: "fixture-source", name: "contentful-monorepo", scope: "product", role: "primary", officialSourceUrl: "https://example.invalid/fixture-source/contentful-monorepo" },
    { id: repositoryId("repo_strapi_fixture"), productId: strapiId, owner: "fixture-source", name: "strapi-fixture", scope: "product", role: "primary", officialSourceUrl: "https://example.invalid/fixture-source/strapi-fixture" },
    { id: repositoryId("repo_payload_fixture"), productId: payloadId, owner: "fixture-source", name: "payload-fixture", scope: "product", role: "primary", officialSourceUrl: "https://example.invalid/fixture-source/payload-fixture" },
    { id: repositoryId("repo_directus_fixture"), productId: directusId, owner: "fixture-source", name: "directus-fixture", scope: "product", role: "primary", officialSourceUrl: "https://example.invalid/fixture-source/directus-fixture" },
  ],
  comparisons: [
    {
      id: comparisonId("cmp_sanity_contentful_fixture"),
      productIds: [contentfulId, sanityId],
      pairKey: pairKey([contentfulId, sanityId]),
      categoryId: FIXTURE_CATEGORY_ID,
      state: "published",
    },
  ],
  comparisonContent: [
    {
      documentId: comparisonContentDocumentId("cmp_sanity_contentful_fixture"),
      comparisonId: comparisonId("cmp_sanity_contentful_fixture"),
      locale: "en",
      state: "published",
      title: "Synthetic fixture comparison: Sanity and Contentful",
    },
  ],
  aiReviews: [completeAiReviewFixture, incompleteAiReviewFixture],
};

export const repositoryRenameFixtureSnapshot: CatalogSnapshot = {
  ...fixtureSnapshot,
  repositories: fixtureSnapshot.repositories.map((repository) =>
    repository.id === repositoryId("repo_sanity_monorepo")
      ? { ...repository, name: "sanity-monorepo-renamed" }
      : repository,
  ),
};

export const fixturePublishedCatalog = toPublishedCatalog(fixtureSnapshot);

export const fixtureCatalogIdAllowlist = createCatalogIdAllowlist({
  productIds: fixturePublishedCatalog.products.map(({ product }) => product.id),
  comparisonIds: fixturePublishedCatalog.comparisons.map(({ comparison }) => comparison.id),
  categoryIds: [FIXTURE_CATEGORY_ID],
});
