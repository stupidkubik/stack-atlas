import { NextResponse, type NextRequest } from "next/server";
import { resolveAppEnvironment } from "./server/config/environment";
import { catalogPreflightRequest, trustedOrigins } from "./server/config/origins";

function unavailable(): Response {
  return new Response("<!doctype html><html lang=\"en\"><head><title>Content temporarily unavailable | PkgCompass</title><meta name=\"robots\" content=\"noindex\"></head><body><main><h1>Content temporarily unavailable</h1><p>Please try again later.</p></main></body></html>", {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

/** RSC cannot set an HTTP error status; preflight through the cached route boundary. */
export async function proxy(request: NextRequest): Promise<Response> {
  try {
    const environment = resolveAppEnvironment();
    // NextURL normalizes loopback IPs to localhost. Match Host against owner
    // configuration, then fetch only that configured origin.
    const selfIdentity = process.env.VERCEL_URL ? {
      origin: `https://${process.env.VERCEL_URL.trim().toLowerCase()}`,
      // Vercel supplies fresh workload identity on each runtime request. The
      // build-time VERCEL_OIDC_TOKEN is deliberately not reused here.
      token: request.headers.get("x-vercel-oidc-token") ?? undefined,
    } : undefined;
    const preflight = catalogPreflightRequest(trustedOrigins(environment), request.headers, selfIdentity);
    if (!preflight) return unavailable();
    if (environment === "fixture") return NextResponse.next();
    const response = await fetch(preflight.url, { headers: preflight.headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (response.status !== 200) return unavailable();
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("available" in value) || value.available !== true) return unavailable();
    return NextResponse.next();
  } catch { return unavailable(); }
}

export const config = {
  matcher: ["/en", "/en/categories/:path*", "/en/tools/:path*", "/en/compare/:path*", "/en/methodology/:path*"],
};
