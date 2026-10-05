import "server-only";

import type { EnvironmentSource } from "./environment";
import { selectComponentTarget } from "./targets";

export interface PublicRuntimeConfig {
  readonly environment: "fixture" | "development" | "production";
  readonly measurement:
    | { readonly enabled: false }
    | { readonly enabled: true; readonly key: string; readonly host: string };
}

export function publicRuntimeConfig(
  source: EnvironmentSource = process.env,
): PublicRuntimeConfig {
  const target = selectComponentTarget("measurement", source);
  if (target.mode === "fixture") return { environment: "fixture", measurement: { enabled: false } };

  return {
    environment: target.environment,
    measurement: {
      enabled: true,
      key: target.settings.NEXT_PUBLIC_POSTHOG_KEY,
      host: target.settings.NEXT_PUBLIC_POSTHOG_HOST,
    },
  };
}
