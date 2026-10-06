import { describe, expect, it } from "vitest";
import { dispatchDailyWorkflow } from "../src/server/collector/daily-dispatch";
import { handleDailyDispatch } from "../src/server/collector/daily-handler";

const source = {
  APP_ENV: "development",
  CRON_SECRET: "c".repeat(40),
  GITHUB_DISPATCH_TOKEN: "test-dispatch-token",
  GITHUB_ACTIONS_REPOSITORY: "stupidkubik/stack-atlas",
  GITHUB_ACTIONS_REF: "work/foundation-first-pass",
};

describe("daily workflow dispatch", () => {
  it("rejects a request with the wrong cron secret without calling GitHub", async () => {
    let calls = 0;
    const response = await handleDailyDispatch(new Request("https://example.test/api/cron/daily", {
      headers: { authorization: `Bearer ${"x".repeat(40)}` },
    }), source, async () => { calls += 1; return new Response(null, { status: 204 }); });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(calls).toBe(0);
  });

  it("dispatches only the configured repository, ref, and environment", async () => {
    let requestUrl = "";
    let request: RequestInit | undefined;
    const response = await handleDailyDispatch(new Request("https://example.test/api/cron/daily", {
      method: "GET",
      headers: { authorization: `Bearer ${source.CRON_SECRET}` },
    }), source, async (url, init) => {
      requestUrl = String(url);
      request = init;
      return new Response(null, { status: 204 });
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ dispatched: true, environment: "development" });
    expect(requestUrl).toBe("https://api.github.com/repos/stupidkubik/stack-atlas/actions/workflows/daily.yml/dispatches");
    expect(new Headers(request?.headers).get("authorization")).toBe(`Bearer ${source.GITHUB_DISPATCH_TOKEN}`);
    expect(JSON.parse(String(request?.body))).toEqual({
      ref: "work/foundation-first-pass",
      inputs: { environment: "development" },
    });
    expect(request?.redirect).toBe("error");
  });

  it("ignores caller-supplied dispatch targets and returns a safe failure for unavailable workflows", async () => {
    let payload = "";
    const request = new Request("https://example.test/api/cron/daily", {
      method: "POST",
      headers: { authorization: `Bearer ${source.CRON_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ environment: "production", repository: "attacker/repo", ref: "main" }),
    });
    const response = await handleDailyDispatch(request, source, async (_url, init) => {
      payload = String(init?.body);
      return new Response(null, { status: 422 });
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "daily_workflow_unavailable" });
    expect(payload).toEqual(JSON.stringify({ ref: source.GITHUB_ACTIONS_REF, inputs: { environment: "development" } }));
  });

  it("validates static repository and ref before making a request", async () => {
    let calls = 0;
    await expect(dispatchDailyWorkflow({
      repository: "stupidkubik/stack-atlas",
      ref: "feature..attacker",
      token: "test-token",
      environment: "development",
      fetcher: async () => { calls += 1; return new Response(null, { status: 204 }); },
    })).rejects.toMatchObject({ code: "daily_dispatch_target_invalid" });
    expect(calls).toBe(0);
  });
});
