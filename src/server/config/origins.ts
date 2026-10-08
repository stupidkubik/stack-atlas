import "server-only";

import { SafeConfigurationError, type AppEnvironment, type EnvironmentSource } from "./environment";

/** Select a configured destination; the inbound Host can never create a fetch URL. */
export function catalogPreflightOrigin(allowed: readonly string[], host: string | null): string | undefined {
  if (!host) return undefined;
  return allowed.find((origin) => new URL(origin).host === host);
}

/** Forward deployment protection only to the same owner-configured origin.
 * App/preview/analytics cookies and request metadata do not belong in this read.
 */
export function catalogPreflightRequest(
  allowed: readonly string[],
  incoming: Headers,
  selfIdentity?: { readonly origin: string; readonly token: string | undefined },
): { readonly url: URL; readonly headers: Headers } | undefined {
  const origin = catalogPreflightOrigin(allowed, incoming.get("host"));
  if (!origin) return undefined;
  const headers = new Headers();
  const oidc = incoming.get("x-vercel-trusted-oidc-idp-token") ||
    (selfIdentity?.origin === origin ? selfIdentity.token : undefined);
  if (oidc) headers.set("x-vercel-trusted-oidc-idp-token", oidc);
  // Vercel's authentication/bypass cookie is a JWT. Reject ambiguous or malformed
  // values instead of copying the user's complete Cookie header.
  const cookies = (incoming.get("cookie") ?? "").split(";").map((part) => part.trim());
  const jwtCookies = cookies.filter((part) => part.startsWith("_vercel_jwt="));
  if (jwtCookies.length === 1 && /^[A-Za-z0-9._~-]+$/.test(jwtCookies[0].slice("_vercel_jwt=".length))) {
    headers.set("cookie", jwtCookies[0]);
  }
  return { url: new URL("/api/catalog-status/", origin), headers };
}

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
