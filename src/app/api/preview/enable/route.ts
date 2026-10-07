import { createClient } from "@sanity/client";
import { validatePreviewUrl } from "@sanity/preview-url-secret";
import { cookies, draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { selectComponentTarget } from "@/server/config/targets";
import { createPreviewSession, PREVIEW_SESSION_COOKIE, PREVIEW_SESSION_TTL_SECONDS, safePreviewRedirect } from "@/server/sanity/preview-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const denied = () => new Response("Preview unavailable", {
  status: 401,
  headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" },
});

export async function GET(request: Request): Promise<Response> {
  try {
    const handshakeUrl = new URL(request.url);
    if (request.url.length > 4096 || handshakeUrl.searchParams.getAll("sanity-preview-secret").length !== 1 || !handshakeUrl.searchParams.get("sanity-preview-secret")?.trim()) return denied();
    const preview = selectComponentTarget("preview");
    const content = selectComponentTarget("content");
    if (preview.mode !== "live" || content.mode !== "live" ||
      content.settings.SANITY_PROJECT_ID !== process.env.SANITY_STUDIO_PROJECT_ID ||
      content.settings.SANITY_DATASET !== process.env.SANITY_STUDIO_DATASET) return denied();
    const client = createClient({
      projectId: content.settings.SANITY_PROJECT_ID,
      dataset: content.settings.SANITY_DATASET,
      apiVersion: content.settings.SANITY_API_VERSION,
      token: preview.settings.SANITY_PREVIEW_READ_TOKEN,
      useCdn: false,
      perspective: "published",
      timeout: 8_000,
      maxRetries: 0,
    });
    const result = await validatePreviewUrl(client, request.url);
    const redirectTo = safePreviewRedirect(result.redirectTo ?? "/en/");
    if (!result.isValid || !redirectTo) return denied();

    const secure = new URL(request.url).protocol === "https:" || process.env.VERCEL === "1";
    const partitioned = secure && request.headers.get("sec-fetch-dest") === "iframe" && request.headers.get("sec-fetch-site") === "cross-site";
    const cookieStore = await cookies();
    cookieStore.set(PREVIEW_SESSION_COOKIE, createPreviewSession({
      secret: preview.settings.PREVIEW_SESSION_SECRET,
      environment: preview.environment,
    }), {
      httpOnly: true,
      secure,
      sameSite: secure ? "none" : "lax",
      partitioned,
      maxAge: PREVIEW_SESSION_TTL_SECONDS,
      path: "/",
    });
    const mode = await draftMode();
    mode.enable();
    const bypass = cookieStore.get("__prerender_bypass");
    if (bypass?.value) cookieStore.set("__prerender_bypass", bypass.value, {
      httpOnly: true,
      secure,
      sameSite: secure ? "none" : "lax",
      partitioned,
      path: "/",
    });
    redirect(redirectTo);
  } catch (error) {
    // Next's redirect is represented by a control-flow exception; let it reach the framework.
    if (error && typeof error === "object" && "digest" in error && typeof (error as { digest?: unknown }).digest === "string" && (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")) throw error;
    return denied();
  }
}
