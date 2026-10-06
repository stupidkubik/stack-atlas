import { NextResponse, type NextRequest } from "next/server";
import { resolveAppEnvironment } from "./server/config/environment";
import { trustedOrigins } from "./server/config/origins";

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
    const origin = request.nextUrl.origin;
    if (!trustedOrigins(environment).includes(origin)) return unavailable();
    if (environment === "fixture") return NextResponse.next();
    const statusUrl = new URL("/api/catalog-status/", origin);
    const response = await fetch(statusUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
    if (response.status !== 200) return unavailable();
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("available" in value) || value.available !== true) return unavailable();
    return NextResponse.next();
  } catch { return unavailable(); }
}

export const config = {
  matcher: ["/en", "/en/categories/:path*", "/en/tools/:path*", "/en/compare/:path*", "/en/methodology/:path*"],
};
