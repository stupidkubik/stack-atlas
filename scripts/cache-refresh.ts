import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isProductId, type ProductId } from "../src/domain/ids";
import type { EnvironmentSource, LiveEnvironment } from "../src/server/config/environment";
import { invalidateMetricsProducts } from "../src/server/collector/invalidation-client";
import { commandEnvironment, loadLocalEnvironment } from "./collect";

export function parseCacheRefreshArgs(argv: readonly string[]) {
  let environment: LiveEnvironment | undefined;
  let allowProduction = false;
  const productIds: ProductId[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env" && !environment) {
      const value = argv[++index];
      if (value !== "development" && value !== "production") throw new Error("cache_refresh_invalid_arguments");
      environment = value;
    } else if (arg === "--product-id") {
      const value = argv[++index];
      if (!isProductId(value)) throw new Error("cache_refresh_invalid_arguments");
      productIds.push(value);
    } else if (arg === "--allow-production" && !allowProduction) {
      allowProduction = true;
    } else throw new Error("cache_refresh_invalid_arguments");
  }
  if (!environment || !productIds.length || productIds.length > 50 ||
    new Set(productIds).size !== productIds.length ||
    (environment === "production") !== allowProduction) throw new Error("cache_refresh_invalid_arguments");
  return { environment, productIds, allowProduction };
}

/** Retries cache invalidation only: never reads sources or writes metrics. */
export async function runCacheRefreshCli(
  argv = process.argv.slice(2),
  source?: EnvironmentSource,
  fetcher?: typeof fetch,
) {
  const args = parseCacheRefreshArgs(argv);
  if (!source) loadLocalEnvironment();
  const environmentSource = commandEnvironment({ ...args, mode: "apply" }, source ?? process.env);
  await invalidateMetricsProducts({ ...args, source: environmentSource, fetcher });
  return { environment: args.environment, products: args.productIds.length, cacheInvalidation: "succeeded" as const };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCacheRefreshCli().then((report) => {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }).catch(() => {
    // Provider errors may contain credentials or private request details.
    process.stderr.write("Cache refresh failed. Check the explicit target, product IDs and invalidation configuration.\n");
    process.exitCode = 1;
  });
}
