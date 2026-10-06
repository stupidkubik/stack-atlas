import { getPublishedCatalogStatus } from "@/server/sanity/public-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The public gate shares the same Data Cache as pages, without returning content. */
export async function GET(): Promise<Response> {
  let status: 200 | 503 = 503;
  try { status = await getPublishedCatalogStatus(); } catch { /* Safe unavailable response. */ }
  return Response.json({ available: status === 200 }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
