import { describe, expect, it, vi } from "vitest";
import { attestDevelopmentTarget, createSyntheticJourney, runPosthogLiveSmoke } from "../scripts/dev/posthog-live-smoke.mjs";

const validArgs = [
  "--live",
  "--env=development",
  "--project-id=295214",
  "--accepted-fixture",
  "--events=page_viewed,comparison_viewed,lead_form_viewed,lead_accepted",
];

function validProcessEnv() {
  return {
    APP_ENV: "development",
    POSTHOG_LIVE_PROJECT_ID: "295214",
    PKGCOMPASS_POSTHOG_LIVE_OPT_IN: "send-allowlisted-synthetic-events",
  };
}

function validLocalEnv() {
  return {
    APP_ENV: "development",
    NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
    NEXT_PUBLIC_POSTHOG_KEY: "phc_test_project_token",
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test_project_token",
  };
}

describe("development PostHog live smoke guard", () => {
  it("requires the exact one-time live opt-in, dev target, and event scope", () => {
    expect(() => attestDevelopmentTarget({ args: validArgs, processEnv: validProcessEnv(), localEnv: validLocalEnv() })).not.toThrow();
    expect(() => attestDevelopmentTarget({
      args: validArgs,
      processEnv: { ...validProcessEnv(), PKGCOMPASS_POSTHOG_LIVE_OPT_IN: undefined },
      localEnv: validLocalEnv(),
    })).toThrowError("live_opt_in_required");
    expect(() => attestDevelopmentTarget({
      args: [...validArgs, "--send-real-events"],
      processEnv: validProcessEnv(),
      localEnv: validLocalEnv(),
    })).toThrowError("usage_or_live_scope_mismatch");
  });

  it("does not open a network connection when the live opt-in is absent", async () => {
    const fetchImpl = vi.fn();
    const report = await runPosthogLiveSmoke({
      args: validArgs,
      processEnv: { ...validProcessEnv(), PKGCOMPASS_POSTHOG_LIVE_OPT_IN: undefined },
      localEnv: validLocalEnv(),
      fetchImpl,
    });
    expect(report).toMatchObject({ status: "blocked", code: "live_opt_in_required" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on production, non-EU, wrong project, conflicting token, or CI contexts", () => {
    expect(() => attestDevelopmentTarget({ args: validArgs, processEnv: { ...validProcessEnv(), APP_ENV: "production" }, localEnv: validLocalEnv() }))
      .toThrowError("app_env_not_development");
    expect(() => attestDevelopmentTarget({ args: validArgs, processEnv: { ...validProcessEnv(), POSTHOG_LIVE_PROJECT_ID: "other" }, localEnv: validLocalEnv() }))
      .toThrowError("project_id_attestation_mismatch");
    expect(() => attestDevelopmentTarget({ args: validArgs, processEnv: validProcessEnv(), localEnv: { ...validLocalEnv(), NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com" } }))
      .toThrowError("posthog_host_not_eu");
    expect(() => attestDevelopmentTarget({ args: validArgs, processEnv: { ...validProcessEnv(), CI: "true" }, localEnv: validLocalEnv() }))
      .toThrowError("untrusted_or_production_execution_context");
    expect(() => attestDevelopmentTarget({ args: validArgs, processEnv: validProcessEnv(), localEnv: { ...validLocalEnv(), NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_other" } }))
      .toThrowError("posthog_project_token_mismatch");
  });

  it("does not send when the configured token is a personal API key or malformed value", async () => {
    const fetchImpl = vi.fn();
    const report = await runPosthogLiveSmoke({
      args: validArgs,
      processEnv: validProcessEnv(),
      localEnv: {
        ...validLocalEnv(),
        NEXT_PUBLIC_POSTHOG_KEY: "phx_personal_api_key",
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phx_personal_api_key",
      },
      fetchImpl,
    });
    expect(report).toMatchObject({ status: "fail", code: "posthog_project_token_unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => attestDevelopmentTarget({
      args: validArgs,
      processEnv: validProcessEnv(),
      localEnv: { ...validLocalEnv(), NEXT_PUBLIC_POSTHOG_KEY: "not-a-project-token" },
    })).toThrowError("posthog_project_token_unavailable");
  });

  it("builds an allowlisted comparison-to-form journey with a fixture-only accepted event", () => {
    const events = createSyntheticJourney({ now: () => 1_800_000_000_000 });
    expect(events.map(({ event }) => event)).toEqual([
      "page_viewed",
      "comparison_viewed",
      "lead_form_viewed",
      "lead_accepted",
    ]);
    expect(events.map(({ timestamp }) => Date.parse(timestamp))).toEqual([...events.map(({ timestamp }) => Date.parse(timestamp))].sort((a, b) => a - b));
    const ids = events.map(({ properties }) => properties.distinct_id);
    expect(new Set(ids).size).toBe(1);
    expect(events[0].properties).toMatchObject({ routeType: "comparison", entityId: "cmp_contentful_sanity_fixture" });
    expect(events[1].properties).toMatchObject({ routeType: "comparison", comparisonId: "cmp_contentful_sanity_fixture" });
    expect(events[2].properties).toMatchObject({ routeType: "lead_form", entryPoint: "comparison" });
    expect(events[3].properties).toMatchObject({
      routeType: "lead_form",
      campaignKey: "demo",
      scenario: "marketing_site",
      eventId: events[3].properties.conversionId,
    });
    expect(events.every(({ properties }) => properties.environment === "development" && !("$process_person_profile" in properties))).toBe(true);
    expect(Object.keys(events[3].properties).sort()).toEqual([
      "campaignKey", "conversionId", "distinct_id", "environment", "eventId", "eventSchemaVersion",
      "locale", "occurredAt", "routeType", "scenario",
    ].sort());
  });

  it("sends only the synthetic event set and returns counts without payload, synthetic ID, or token", async () => {
    const token = "phc_sensitive_test_value";
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string, options: RequestInit) => {
      calls.push({ url, body: String(options.body) });
      return new Response("{\"status\":\"ok\"}", { status: 200, headers: { "content-type": "application/json" } });
    });
    const report = await runPosthogLiveSmoke({
      args: validArgs,
      processEnv: validProcessEnv(),
      localEnv: { ...validLocalEnv(), NEXT_PUBLIC_POSTHOG_KEY: token, NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: token },
      fetchImpl,
      now: () => 1_800_000_000_000,
    });

    expect(report).toMatchObject({
      environment: "development",
      projectId: "295214",
      status: "pass",
      code: "accepted_transport",
      checks: {
        hostRegion: "eu",
        transportAcceptedEventCounts: { page_viewed: 1, comparison_viewed: 1, lead_form_viewed: 1, lead_accepted: 1 },
        syntheticAcceptedFixtureTransportCount: 1,
        realLeadAccepted: 0,
        crmRequests: 0,
        providerPersonProfileMayBeCreated: true,
        payloadPersistedLocally: false,
        syntheticDistinctIdPersistedLocally: false,
        projectTokenPersistedLocally: false,
      },
    });
    expect(calls).toHaveLength(4);
    expect(calls.every(({ url }) => url === "https://eu.i.posthog.com/i/v0/e/")).toBe(true);
    expect(calls.map(({ body }) => JSON.parse(body).event)).toEqual([
      "page_viewed", "comparison_viewed", "lead_form_viewed", "lead_accepted",
    ]);
    const requests = calls.map(({ body }) => JSON.parse(body));
    expect(requests.every((request) => request.token === token && !("token" in request.properties))).toBe(true);
    expect(requests.every((request) => !("$process_person_profile" in request.properties))).toBe(true);
    expect(requests.every((request) => typeof request.properties.distinct_id === "string" && request.properties.distinct_id.startsWith("pkgcompass-fp04-smoke-"))).toBe(true);
    const output = JSON.stringify(report);
    expect(output).not.toContain(token);
    expect(output).not.toContain(JSON.parse(calls[0].body).properties.distinct_id);
    expect(output).not.toContain(JSON.parse(calls[3].body).properties.conversionId);
  });

  it("stops on quota or transport errors without exposing the provider response", async () => {
    const fetchImpl = vi.fn(async () => new Response("{\"quota_limited\":[\"events\"],\"token\":\"must-not-print\"}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const report = await runPosthogLiveSmoke({
      args: validArgs,
      processEnv: validProcessEnv(),
      localEnv: validLocalEnv(),
      fetchImpl,
    });
    expect(report).toMatchObject({ status: "fail", code: "posthog_quota_limited" });
    expect(report.checks.transportAcceptedEventCounts.page_viewed).toBe(0);
    expect(JSON.stringify(report)).not.toContain("must-not-print");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
