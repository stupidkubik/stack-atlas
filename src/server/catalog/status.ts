import type { AppEnvironment } from "../config/environment";

/** Public status projection; never includes the catalog target or connection details. */
export function catalogStatusProjection(
  environment: AppEnvironment,
  status: 200 | 503,
): { readonly available: boolean; readonly environment: AppEnvironment } {
  return { available: status === 200, environment };
}
