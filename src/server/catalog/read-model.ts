import "server-only";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MappingIdentity } from "../../domain/data-contracts";
import type { MetricReadValue } from "../../domain/metrics-read-model";
import { readMetricsForMappings } from "../db/metrics-repository";

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
