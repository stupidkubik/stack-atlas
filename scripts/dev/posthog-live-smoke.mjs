#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { createCatalogIdAllowlist, sanitizeAnalyticsEvent } from "../../src/domain/measurement.ts";

const projectId = "295214";
const euHost = "https://eu.i.posthog.com";
const requiredArgs = [
  "--live",
  "--env=development",
  `--project-id=${projectId}`,
  "--accepted-fixture",
  "--events=page_viewed,comparison_viewed,lead_form_viewed,lead_accepted",
];
const smokeEvents = [
  "page_viewed",
  "comparison_viewed",
  "lead_form_viewed",
  "lead_accepted",
];
// Development seed's published Sanity/Contentful comparison.
const comparisonId = "cmp_contentful_sanity_fixture";
const publishedDevelopmentComparisonAllowlist = createCatalogIdAllowlist({
  productIds: [],
  comparisonIds: [comparisonId],
  categoryIds: [],
});
const maxResponseCharacters = 8_192;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isTruthyFlag(value) {
  return typeof value === "string" && value !== "" && !["0", "false", "no"].includes(value.toLowerCase());
}

function requireExactArguments(args) {
  if (args.length !== requiredArgs.length || args.some((arg, index) => arg !== requiredArgs[index])) {
    fail("usage_or_live_scope_mismatch");
  }
}

export function attestDevelopmentTarget({ args, processEnv, localEnv }) {
  requireExactArguments(args);
  if (processEnv.PKGCOMPASS_POSTHOG_LIVE_OPT_IN !== "send-allowlisted-synthetic-events") {
    fail("live_opt_in_required");
  }
  if (processEnv.APP_ENV !== "development" || (localEnv.APP_ENV?.trim() && localEnv.APP_ENV.trim() !== "development")) {
    fail("app_env_not_development");
  }
  if (processEnv.POSTHOG_LIVE_PROJECT_ID !== projectId) fail("project_id_attestation_mismatch");
  if (localEnv.NEXT_PUBLIC_POSTHOG_HOST !== euHost) fail("posthog_host_not_eu");
  if (typeof localEnv.NEXT_PUBLIC_POSTHOG_KEY !== "string" || !/^phc_[A-Za-z0-9_]+$/.test(localEnv.NEXT_PUBLIC_POSTHOG_KEY)) {
    fail("posthog_project_token_unavailable");
  }
  if (
    localEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN !== undefined &&
    localEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN !== localEnv.NEXT_PUBLIC_POSTHOG_KEY
  ) {
    fail("posthog_project_token_mismatch");
  }
  if (processEnv.NEXT_PUBLIC_POSTHOG_HOST && processEnv.NEXT_PUBLIC_POSTHOG_HOST !== localEnv.NEXT_PUBLIC_POSTHOG_HOST) {
    fail("posthog_host_override_mismatch");
  }
  if (processEnv.NEXT_PUBLIC_POSTHOG_KEY && processEnv.NEXT_PUBLIC_POSTHOG_KEY !== localEnv.NEXT_PUBLIC_POSTHOG_KEY) {
    fail("posthog_project_token_override_mismatch");
  }
  if (isTruthyFlag(processEnv.CI) || isTruthyFlag(processEnv.VERCEL) || isTruthyFlag(processEnv.VERCEL_ENV) ||
    isTruthyFlag(processEnv.GITHUB_ACTIONS) || isTruthyFlag(processEnv.PKGCOMPASS_UNTRUSTED_PR) ||
    processEnv.NODE_ENV === "production") {
    fail("untrusted_or_production_execution_context");
  }

  return {
    host: euHost,
    projectId,
    projectToken: localEnv.NEXT_PUBLIC_POSTHOG_KEY,
  };
}

function makeTransportEvent({ name, routeType, eventId, occurredAt, distinctId, additional }) {
  const sanitized = sanitizeAnalyticsEvent({
    name,
    eventSchemaVersion: 1,
    environment: "development",
    routeType,
    locale: "en",
    occurredAt,
    eventId,
    ...additional,
  }, publishedDevelopmentComparisonAllowlist);
  if (!sanitized) fail("synthetic_event_rejected_by_runtime_schema");
  const { name: safeName, ...properties } = sanitized;
  return {
    event: safeName,
    timestamp: occurredAt,
    properties: { ...properties, distinct_id: distinctId },
  };
}

export function createSyntheticJourney({ now = Date.now, randomUUID = () => crypto.randomUUID() } = {}) {
  const distinctId = `pkgcompass-fp04-smoke-${randomUUID()}`;
  let lastTimestamp = 0;
  const makeEvent = (name, routeType, additional = {}, conversionEvent = false) => {
    const timestampMs = Math.max(now(), lastTimestamp + 1);
    lastTimestamp = timestampMs;
    const timestamp = new Date(timestampMs).toISOString();
    const conversionId = conversionEvent ? randomUUID() : undefined;
    const id = conversionId ?? randomUUID();
    return makeTransportEvent({
        name,
        routeType,
        eventId: id,
        occurredAt: timestamp,
        distinctId,
        additional: {
          ...(conversionEvent ? { conversionId: id } : {}),
          ...additional,
        },
      });
  };

  return [
    makeEvent("page_viewed", "comparison", { entityId: comparisonId }),
    makeEvent("comparison_viewed", "comparison", { comparisonId }),
    makeEvent("lead_form_viewed", "lead_form", { entryPoint: "comparison" }),
    makeEvent("lead_accepted", "lead_form", {
      scenario: "marketing_site",
      // The permitted demo campaign key labels this accepted event as a fixture in the project.
      campaignKey: "demo",
    }, true),
  ];
}

async function readResponseMetadata(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseCharacters) fail("posthog_response_too_large");
  let text;
  try { text = await response.text(); } catch { fail("posthog_response_unreadable"); }
  if (text.length > maxResponseCharacters) fail("posthog_response_too_large");
  try {
    const body = JSON.parse(text);
    if (Array.isArray(body?.quota_limited) && body.quota_limited.length > 0) fail("posthog_quota_limited");
  } catch (error) {
    if (error?.code === "posthog_quota_limited") throw error;
    // Successful ingestion responses may be plain text; status is checked separately.
  }
}

async function sendEvent({ host, projectToken }, event, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${host}/i/v0/e/`, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      // PostHog's documented /i/v0/e envelope uses root `token` and properties.distinct_id.
      body: JSON.stringify({ token: projectToken, ...event }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    fail("posthog_transport_failed");
  }
  if (!response.ok) fail(`posthog_http_${response.status}`);
  await readResponseMetadata(response);
}

export async function runPosthogLiveSmoke({
  args,
  processEnv,
  localEnv,
  fetchImpl = fetch,
  now = Date.now,
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  const sentCounts = Object.fromEntries(smokeEvents.map((name) => [name, 0]));
  let status = "blocked";
  let code = "configuration_not_attested";
  try {
    const target = attestDevelopmentTarget({ args, processEnv, localEnv });
    const events = createSyntheticJourney({ now, randomUUID });
    for (const event of events) {
      await sendEvent(target, event, fetchImpl);
      sentCounts[event.event] += 1;
    }
    status = "pass";
    code = "accepted_transport";
  } catch (error) {
    code = typeof error?.code === "string" ? error.code : "posthog_smoke_failed";
    status = code === "live_opt_in_required" ? "blocked" : "fail";
  }

  return {
    environment: "development",
    projectId,
    status,
    code,
    checks: {
      hostRegion: "eu",
      transportAcceptedEventCounts: sentCounts,
      syntheticAcceptedFixtureTransportCount: sentCounts.lead_accepted,
      realLeadAccepted: 0,
      crmRequests: 0,
      providerPersonProfileMayBeCreated: true,
      payloadPersistedLocally: false,
      syntheticDistinctIdPersistedLocally: false,
      projectTokenPersistedLocally: false,
    },
  };
}

function readLocalEnvironment() {
  try {
    return parseEnv(readFileSync(".env.local", "utf8"));
  } catch {
    fail("development_config_unavailable");
  }
}

async function main() {
  const report = await runPosthogLiveSmoke({
    args: process.argv.slice(2),
    processEnv: process.env,
    localEnv: readLocalEnvironment(),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify({ environment: "development", projectId, status: "fail", code: "posthog_smoke_failed" })}\n`);
    process.exitCode = 1;
  });
}
