import { revalidatePath, revalidateTag } from "next/cache";
import { selectComponentTarget } from "@/server/config/targets";
import { handlePublicationInvalidation } from "@/server/invalidation/handlers";
import { PUBLISHED_CMS_CACHE_TAG } from "@/server/sanity/public-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const target = selectComponentTarget("webhook");
    const content = selectComponentTarget("content");
    if (target.mode !== "live" || content.mode !== "live") throw new Error("unavailable");
    return await handlePublicationInvalidation(request, {
      secret: target.settings.SANITY_WEBHOOK_SECRET,
      environment: target.environment,
      dataset: content.settings.SANITY_DATASET,
      waitForConsistency: () => new Promise((resolve) => setTimeout(resolve, 3000)),
      invalidate() {
        // A single published snapshot drives every editorial page and metadata.
        revalidateTag(PUBLISHED_CMS_CACHE_TAG, { expire: 0 });
        revalidatePath("/en", "layout");
      },
    });
  } catch { return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } }); }
}
