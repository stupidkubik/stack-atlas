import "server-only";

import type { PublishedCatalog } from "../domain/catalog";
import type { ContentRepository, MetricsReader } from "../domain/ports";
import type { CurrentMetric } from "../domain/metrics";

export type CatalogReadResult =
  | { readonly status: 503; readonly code: "cms_unavailable" }
  | {
      readonly status: 200;
      readonly catalog: PublishedCatalog;
      readonly metrics:
        | { readonly status: "available"; readonly values: readonly CurrentMetric[] }
        | { readonly status: "unavailable" };
    };

/** Read published content first; SQL failure never hides otherwise usable content. */
export async function readPublishedCatalog(
  content: ContentRepository,
  metrics: MetricsReader,
): Promise<CatalogReadResult> {
  let catalogResult: Awaited<ReturnType<ContentRepository["getPublishedCatalog"]>>;
  try {
    catalogResult = await content.getPublishedCatalog();
  } catch {
    return { status: 503, code: "cms_unavailable" };
  }
  if (!catalogResult.ok) return { status: 503, code: "cms_unavailable" };

  try {
    const productIds = catalogResult.value.products.map(({ product }) => product.id);
    const metricsResult = await metrics.readCurrent(productIds);
    return {
      status: 200,
      catalog: catalogResult.value,
      metrics: metricsResult.ok
        ? { status: "available", values: metricsResult.value }
        : { status: "unavailable" },
    };
  } catch {
    return {
      status: 200,
      catalog: catalogResult.value,
      metrics: { status: "unavailable" },
    };
  }
}
