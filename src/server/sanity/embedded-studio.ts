import "server-only";

import type { StudioPublicSettings } from "../../../studio/config";
import type { EnvironmentSource } from "../config/environment";
import { trustedOrigins } from "../config/origins";
import { selectComponentTarget } from "../config/targets";

/** Never serialize the component target or credential-bearing environment. */
export function readEmbeddedStudioSettings(source: EnvironmentSource = process.env): StudioPublicSettings | null {
  const target = selectComponentTarget("content", source);
  if (target.mode === "fixture") return null;
  const allowed = trustedOrigins(target.environment, source);
  const deploymentOrigin = source.VERCEL_URL ? `https://${source.VERCEL_URL.trim().toLowerCase()}` : undefined;
  const previewOrigin = deploymentOrigin && allowed.includes(deploymentOrigin) ? deploymentOrigin : allowed[0];
  return {
    projectId: target.settings.SANITY_PROJECT_ID,
    dataset: target.settings.SANITY_DATASET,
    previewOrigin,
  };
}
