import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { buildPublishedAiReadiness, type PublishedAiMapping } from "./ai-review";
import type { AiReadiness } from "../../domain/ai-readiness";
import type { MappingIdentity } from "../../domain/data-contracts";
import type { MetricReadValue } from "../../domain/metrics-read-model";
import { comparisonPath } from "../../domain/public-urls";
import { selectComponentTarget } from "../config/targets";
import { createPooledMetricsReader } from "../db/connections";
import { readMetricsForMappings } from "../db/metrics-repository";
import { readPublishedMappings } from "../sanity/published-mapping";
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
  if (!product) return { status: 404 };

  const mapped = await readPublishedMappings([product.product.id]);
  const mapping = mapped.ok ? mapped.value.find(({ productId }) => productId === product.product.id) : undefined;
  const comparisons = cms.model.comparisons.flatMap(({ comparison, content }) => {
    if (!comparison.productIds.includes(product.product.id)) return [];
    const products = comparison.productIds.map((id) => cms.model.products.find(({ product: candidate }) => candidate.id === id)?.product);
    return products[0] && products[1] ? [{ content, href: comparisonPath([products[0], products[1]]) }] : [];
  });
  if (!mapping) return { status: 200, product, source: cms.source, metrics: { status: "unavailable" }, comparisons };

  const domainMapping: MappingIdentity = {
    productId: mapping.productId,
    primaryPackage: mapping.primaryPackage,
    primaryRepository: mapping.primaryRepository,
  };
  const readinessMapping: PublishedAiMapping = {
    productId: mapping.productId,
    mappingKey: mapping.mappingKey,
    hasComparableSdk: Boolean(mapping.primaryPackage),
  };
  const review = cms.model.catalog.products.find(({ product: value }) => value.id === product.product.id)?.aiReview;
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
