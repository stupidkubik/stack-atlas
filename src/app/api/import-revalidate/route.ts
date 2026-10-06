import { revalidatePath, revalidateTag } from "next/cache";
import { selectComponentTarget } from "@/server/config/targets";
import { handleMetricsInvalidation } from "@/server/invalidation/handlers";
import { getPublishedCatalogRead } from "@/server/sanity/public-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const target = selectComponentTarget("importInvalidation");
    if (target.mode !== "live") throw new Error("unavailable");
    return await handleMetricsInvalidation(request, {
      secret: target.settings.IMPORT_INVALIDATION_SECRET,
      environment: target.environment,
      async publishedProductIds() {
        const result = await getPublishedCatalogRead();
        return result.status === 200 ? result.model.products.map(({ product }) => product.id) : undefined;
      },
      invalidate(productIds) {
        for (const id of productIds) revalidateTag(`metrics:${id}`, { expire: 0 });
        revalidateTag("metrics", { expire: 0 });
        revalidatePath("/en", "layout");
      },
    });
  } catch { return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } }); }
}
