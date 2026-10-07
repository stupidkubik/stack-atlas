import { getPublishedCatalogStatus } from "@/server/sanity/public-read";
import { resolveAppEnvironment } from "@/server/config/environment";
import { catalogStatusProjection } from "@/server/catalog/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The public gate shares the same Data Cache as pages, without returning content. */
export async function GET(): Promise<Response> {
  let environment: ReturnType<typeof resolveAppEnvironment>;
  try { environment = resolveAppEnvironment(); } catch {
    return Response.json({ available: false }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }
  let status: 200 | 503 = 503;
  try { status = await getPublishedCatalogStatus(); } catch { /* Safe unavailable response. */ }
  return Response.json(catalogStatusProjection(environment, status), {
    status,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
