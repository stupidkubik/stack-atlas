import "server-only";

import { SafeConfigurationError, type AppEnvironment, type EnvironmentSource } from "./environment";

/** Origins belong to the deployment owner, never request headers or form fields. */
export function trustedOrigins(environment: AppEnvironment, source: EnvironmentSource = process.env): readonly string[] {
  const result = new Set<string>();
  if (environment === "fixture") {
    result.add("http://127.0.0.1:3000");
    result.add("http://localhost:3000");
    try {
      const local = new URL(source.SITE_URL ?? "");
      if (["localhost", "127.0.0.1", "[::1]"].includes(local.hostname) &&
        ["http:", "https:"].includes(local.protocol) && !local.username && !local.password &&
        !local.search && !local.hash && local.pathname === "/") result.add(local.origin);
    } catch { /* Fixture targets ignore invalid or inherited live configuration. */ }
    return [...result];
  }
  const configured = source.SITE_URL?.trim();
  if (configured) {
    let url: URL;
    try { url = new URL(configured); } catch {
      throw new SafeConfigurationError({ code: "invalid_configuration", setting: "SITE_URL" });
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(environment === "development" && loopback && url.protocol === "http:"))) {
      throw new SafeConfigurationError({ code: "invalid_configuration", setting: "SITE_URL" });
    }
    result.add(url.origin);
  } else {
    throw new SafeConfigurationError({ code: "missing_configuration", setting: "SITE_URL" });
  }
  if (environment === "development") {
    for (const key of ["VERCEL_URL", "VERCEL_BRANCH_URL"] as const) {
      const host = source[key]?.trim();
      if (!host) continue;
      if (!/^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(host) || host.includes("..")) {
        throw new SafeConfigurationError({ code: "invalid_configuration", setting: key });
      }
      result.add(`https://${host.toLowerCase()}`);
    }
  }
  return [...result];
}
