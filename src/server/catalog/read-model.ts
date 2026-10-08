import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { buildPublishedAiReadiness, type PublishedAiMapping } from "./ai-review";
import type { AiReadiness } from "../../domain/ai-readiness";
import { packageId, repositoryId } from "../../domain/ids";
import type { MappingIdentity } from "../../domain/data-contracts";
import type { MetricReadValue } from "../../domain/metrics-read-model";
import { comparisonPath } from "../../domain/public-urls";
import { selectComponentTarget } from "../config/targets";
import { createPooledMetricsReader } from "../db/connections";
import { readMetricsForMappings } from "../db/metrics-repository";
import { readAiSdkVersion } from "../../domain/ai-review-version";
import { computeMappingKey } from "../../domain/mapping-key";
import { getPublishedCatalogRead, type CmsPublicProduct } from "../sanity/public-read";

export type CatalogMetricsReadResult =
  | { readonly status: "available"; readonly values: readonly MetricReadValue[] }
  | { readonly status: "unavailable" };

/** PostgreSQL failure affects metric labels only; callers retain published CMS content. */
export async function readCatalogMetrics(input: {
  readonly db: NodePgDatabase;
  readonly mappings: readonly MappingIdentity[];
  readonly now?: Date;
}): Promise<CatalogMetricsReadResult> {
  try {
    return { status: "available", values: await readMetricsForMappings(input) };
  } catch {
    return { status: "unavailable" };
  }
}

export type PublicProductRead =
  | { readonly status: 404 }
  | { readonly status: 503 }
  | { readonly status: 308; readonly location: string }
  | {
      readonly status: 200;
      readonly product: CmsPublicProduct;
      readonly source: "live" | "valid_cache" | "fixture";
      readonly metrics: CatalogMetricsReadResult;
      readonly aiReadiness?: AiReadiness;
      readonly comparisons: readonly { readonly content: import("../sanity/public-read").CmsPublicComparison["content"]; readonly href: string }[];
    };

/** Joins the published CMS projection to current source identities and data states. */
export async function readPublicProduct(slug: string, now = new Date()): Promise<PublicProductRead> {
  const cms = await getPublishedCatalogRead();
  if (cms.status !== 200) return { status: 503 };
  const product = cms.model.products.find(({ product: value }) => value.routeSlug === slug);
  if (!product) {
    const redirect = cms.model.redirects.find(({ sourcePath }) => sourcePath === `/en/tools/${slug}/`);
    return redirect ? { status: 308, location: redirect.targetPath } : { status: 404 };
  }

  const comparisons = cms.model.comparisons.flatMap(({ comparison, content }) => {
    if (!comparison.productIds.includes(product.product.id)) return [];
    const products = comparison.productIds.map((id) => cms.model.products.find(({ product: candidate }) => candidate.id === id)?.product);
    return products[0] && products[1] ? [{ content, href: comparisonPath([products[0], products[1]]) }] : [];
  });
  // Metrics use only the selected source identity in the public CMS projection.
  // AI evidence/version validation must never hide otherwise valid metrics.
  const selectedPackage = product.packages.find(({ id }) => id === product.product.primaryPackageId);
  const selectedRepository = product.repositories.find(({ id }) => id === product.product.primaryRepositoryId);
  const domainMapping: MappingIdentity = {
    productId: product.product.id,
    primaryPackage: selectedPackage ? { id: packageId(selectedPackage.id), packageName: selectedPackage.packageName } : null,
    primaryRepository: selectedRepository ? { id: repositoryId(selectedRepository.id), owner: selectedRepository.owner, name: selectedRepository.name } : null,
  };
  const review = cms.model.catalog.products.find(({ product: value }) => value.id === product.product.id)?.aiReview;
  const sdkPackageVersion = domainMapping.primaryPackage ? readAiSdkVersion(review) : null;
  const readinessMapping: PublishedAiMapping = {
    productId: domainMapping.productId,
    mappingKey: sdkPackageVersion === undefined ? "invalid_review_version" : await computeMappingKey({ ...domainMapping, sdkPackageVersion }),
    hasComparableSdk: Boolean(domainMapping.primaryPackage),
  };
  const aiReadiness = buildPublishedAiReadiness({
    mappings: [readinessMapping],
    publishedReviews: review ? [review] : [],
    now,
  })[0];

  let metrics: CatalogMetricsReadResult = { status: "unavailable" };
  let reader: ReturnType<typeof createPooledMetricsReader> | undefined;
  try {
    if (selectComponentTarget("metricsReader").mode === "live") {
      reader = createPooledMetricsReader();
      metrics = await readCatalogMetrics({ db: reader.db, mappings: [domainMapping], now });
    }
  } catch {
    metrics = { status: "unavailable" };
  } finally {
    await reader?.close().catch(() => {});
  }
  return { status: 200, product, source: cms.source, metrics, aiReadiness, comparisons };
}
