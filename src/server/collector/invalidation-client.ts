import "server-only";

import { isProductId, type ProductId } from "../../domain/ids";
import type { AppEnvironment, EnvironmentSource, LiveEnvironment } from "../config/environment";
import { trustedOrigins } from "../config/origins";
import { selectComponentTarget } from "../config/targets";

export interface MetricsInvalidationInput {
  readonly environment: LiveEnvironment;
  readonly productIds: readonly ProductId[];
  readonly source?: EnvironmentSource;
  readonly fetcher?: typeof fetch;
}

/** Sends only the route's allowlisted product IDs; cache tags remain server-owned. */
export async function invalidateMetricsProducts(input: MetricsInvalidationInput): Promise<void> {
  if (
    input.productIds.length === 0 || input.productIds.length > 50 ||
    input.productIds.some((id) => !isProductId(id)) ||
    new Set(input.productIds).size !== input.productIds.length
  ) throw new Error("metrics_invalidation_input_invalid");

  const source = input.source ?? process.env;
  const appEnvironment: AppEnvironment = input.environment;
  if (source.APP_ENV && source.APP_ENV.trim() !== appEnvironment) throw new Error("metrics_invalidation_target_invalid");
  const target = selectComponentTarget("importInvalidation", source.APP_ENV ? source : { ...source, APP_ENV: appEnvironment });
  if (target.mode !== "live" || target.environment !== appEnvironment) throw new Error("metrics_invalidation_target_invalid");
  const origins = trustedOrigins(appEnvironment, source);
  const configuredOrigin = source.SITE_URL?.trim();
  if (!configuredOrigin) throw new Error("metrics_invalidation_target_invalid");

  const url = new URL("/api/import-revalidate", new URL(configuredOrigin));
  if (!origins.includes(url.origin)) throw new Error("metrics_invalidation_target_invalid");
  const response = await (input.fetcher ?? fetch)(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${target.settings.IMPORT_INVALIDATION_SECRET}`,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      environment: appEnvironment,
      productIds: [...input.productIds],
    }),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("metrics_invalidation_failed");
}
