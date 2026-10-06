import "server-only";

import { timingSafeEqual } from "node:crypto";
import { resolveAppEnvironment, type EnvironmentSource } from "../config/environment";
import { selectComponentTarget } from "../config/targets";
import { dispatchDailyWorkflow, DailyDispatchError } from "./daily-dispatch";

function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(header, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function handleDailyDispatch(
  request: Request,
  source: EnvironmentSource = process.env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const secret = source.CRON_SECRET?.trim();
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorized" }, {
      status: 401,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }

  try {
    const environment = resolveAppEnvironment(source);
    if (environment === "fixture") throw new Error("daily_fixture_target");
    const target = selectComponentTarget("daily", source);
    if (target.mode !== "live" || target.environment !== environment) throw new Error("daily_target_invalid");
    await dispatchDailyWorkflow({
      repository: target.settings.GITHUB_ACTIONS_REPOSITORY,
      ref: target.settings.GITHUB_ACTIONS_REF,
      token: target.settings.GITHUB_DISPATCH_TOKEN,
      environment,
      fetcher,
    });
    return Response.json({ dispatched: true, environment }, {
      status: 202,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  } catch (error) {
    const code = error instanceof DailyDispatchError && error.code === "daily_workflow_unavailable"
      ? "daily_workflow_unavailable"
      : "daily_dispatch_unavailable";
    return Response.json({ error: code }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }
}
