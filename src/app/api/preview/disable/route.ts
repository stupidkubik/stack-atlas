import { cookies, draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { PREVIEW_SESSION_COOKIE } from "@/server/sanity/preview-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const store = await cookies();
  store.delete(PREVIEW_SESSION_COOKIE);
  (await draftMode()).disable();
  redirect("/en/");
}
