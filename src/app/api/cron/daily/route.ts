import { handleDailyDispatch } from "@/server/collector/daily-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleDailyDispatch(request);
}
