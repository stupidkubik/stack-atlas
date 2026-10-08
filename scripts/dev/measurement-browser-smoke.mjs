#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { chromium } from "@playwright/test";
import { unpackPosthogEvents } from "./posthog-smoke-transport.mjs";

let currentPhase = "configuration";

function emit(status, code, checks) {
  process.stdout.write(`${JSON.stringify({ environment: "development", status, code, ...(checks ? { checks } : {}) })}\n`);
}

function requireSafe(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function readLocalEnvironment() {
  const local = parseEnv(readFileSync(".env.local", "utf8"));
  const explicitAppEnvironment = process.env.APP_ENV?.trim();
  requireSafe(explicitAppEnvironment === "development", "app_env_not_development");
  requireSafe(!local.APP_ENV?.trim() || local.APP_ENV.trim() === explicitAppEnvironment, "environment_mismatch");
  requireSafe(local.NEXT_PUBLIC_POSTHOG_HOST === "https://eu.i.posthog.com", "posthog_host_not_eu");
  requireSafe(typeof local.NEXT_PUBLIC_POSTHOG_KEY === "string" && local.NEXT_PUBLIC_POSTHOG_KEY.length > 0, "posthog_key_unavailable");
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_KEY !== local.NEXT_PUBLIC_POSTHOG_KEY) {
    requireSafe(false, "posthog_key_mismatch");
  }
  if (process.env.NEXT_PUBLIC_POSTHOG_HOST && process.env.NEXT_PUBLIC_POSTHOG_HOST !== local.NEXT_PUBLIC_POSTHOG_HOST) {
    requireSafe(false, "posthog_host_mismatch");
  }
  const site = new URL(process.env.SITE_URL?.trim() || "");
  requireSafe(
    ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname) &&
      ["http:", "https:"].includes(site.protocol) && !site.username && !site.password &&
      !site.search && !site.hash && site.pathname === "/",
    "site_origin_not_loopback",
  );
  return { origin: site.origin, expectedToken: local.NEXT_PUBLIC_POSTHOG_KEY };
}

async function checkDevelopmentRuntime(origin) {
  let response;
  try {
    response = await fetch(new URL("/api/catalog-status/", origin), {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw Object.assign(new Error("development_runtime_not_attested"), { code: "RUNTIME_ATTESTATION_UNREACHABLE" });
  }
  let body;
  try { body = await response.json(); } catch {
    throw Object.assign(new Error("development_runtime_not_attested"), { code: "RUNTIME_ATTESTATION_INVALID_JSON" });
  }
  if (!((response.status === 200 || response.status === 503) &&
    body?.environment === "development" && typeof body.available === "boolean" &&
    body.available === (response.status === 200))) {
    throw Object.assign(new Error("development_runtime_not_attested"), { code: "RUNTIME_ATTESTATION_MISMATCH" });
  }
}

async function main() {
  requireSafe(
    process.argv.length === 4 && process.argv[2] === "--env=development" && process.argv[3] === "--offline-fixture",
    "usage",
  );
  requireSafe(
    process.env.CI !== "true" && process.env.CI !== "1" && !process.env.VERCEL &&
      !process.env.VERCEL_ENV && process.env.GITHUB_EVENT_NAME !== "pull_request" &&
      process.env.PKGCOMPASS_UNTRUSTED_PR !== "true",
    "untrusted_execution_context",
  );

  const { origin, expectedToken } = readLocalEnvironment();
  currentPhase = "runtime_attestation";
  await checkDevelopmentRuntime(origin);
  currentPhase = "launch";
  const browser = await chromium.launch({ headless: true });
  currentPhase = "browser_context";
  const context = await browser.newContext();
  let blockedExternalRequests = 0;
  let blockedPosthogHostRequests = 0;
  const blockedPosthogHostKinds = { expectedEu: 0, euAssets: 0, euAlias: 0, otherPosthog: 0 };
  const blockedPosthogPathKinds = { event: 0, ingestion: 0, flags: 0, remoteConfig: 0, other: 0 };
  let offlinePosthogFixtures = 0;
  // All form writes are fulfilled in memory. Even a missing fixture must never
  // fall through to the development API/CRM.
  const leadFixtures = [];
  const leadAttempts = [];
  let unexpectedLeadRequest = false;
  let blockAnalyticsTransport = false;
  let intentionallyBlockedAnalyticsRequests = 0;
  const conversionFixture = "11111111-1111-4111-8111-111111111111";
  await context.route("**/*", async (route) => {
    let requestUrl;
    try { requestUrl = new URL(route.request().url()); } catch {
      blockedExternalRequests += 1;
      await route.abort();
      return;
    }
    if (requestUrl.origin === origin) {
      if (requestUrl.pathname === "/api/leads/" && route.request().method() === "POST") {
        const fixture = leadFixtures.shift();
        if (!fixture) {
          unexpectedLeadRequest = true;
          await route.abort();
          return;
        }
        leadAttempts.push(route.request().postDataJSON());
        fixture.started?.();
        if (fixture.release) await fixture.release;
        if (fixture.abort) await route.abort();
        else await route.fulfill({ status: fixture.status ?? 200, contentType: "application/json", body: JSON.stringify(fixture.body) });
        return;
      }
      await route.continue();
      return;
    }
    if (requestUrl.hostname.endsWith("posthog.com")) {
      if (requestUrl.hostname === "eu-assets.i.posthog.com") {
        blockedPosthogHostRequests += 1;
        blockedPosthogHostKinds.euAssets += 1;
        if (/^\/array\//.test(requestUrl.pathname)) blockedPosthogPathKinds.remoteConfig += 1;
        else blockedPosthogPathKinds.other += 1;
      } else if (requestUrl.hostname !== "eu.i.posthog.com") {
        blockedPosthogHostRequests += 1;
        if (requestUrl.hostname.startsWith("eu.")) blockedPosthogHostKinds.euAlias += 1;
        else blockedPosthogHostKinds.otherPosthog += 1;
        if (/^\/e(?:\/|$)/.test(requestUrl.pathname)) blockedPosthogPathKinds.event += 1;
        else if (/^\/i\/v0\/e(?:\/|$)|^\/batch(?:\/|$)|^\/capture(?:\/|$)/.test(requestUrl.pathname)) {
          blockedPosthogPathKinds.ingestion += 1;
        } else if (/flags|decide/i.test(requestUrl.pathname)) blockedPosthogPathKinds.flags += 1;
        else if (/^\/array\//.test(requestUrl.pathname)) blockedPosthogPathKinds.remoteConfig += 1;
        else blockedPosthogPathKinds.other += 1;
      } else {
        const pathKind = /^\/e(?:\/|$)/.test(requestUrl.pathname)
          ? "event"
          : /^\/i\/v0\/e(?:\/|$)|^\/batch(?:\/|$)|^\/capture(?:\/|$)/.test(requestUrl.pathname)
            ? "ingestion"
            : /flags|decide/i.test(requestUrl.pathname)
              ? "flags"
              : "other";
        blockedPosthogHostKinds.expectedEu += 1;
        blockedPosthogPathKinds[pathKind] += 1;
        if (blockAnalyticsTransport) {
          intentionallyBlockedAnalyticsRequests += 1;
          await route.abort();
          return;
        }
        collectPosthogRequest(route.request());
        if (route.request().method() === "POST" && (pathKind === "event" || pathKind === "ingestion")) {
          offlinePosthogFixtures += 1;
          await route.fulfill({ status: 200, contentType: "application/json", body: "{\"status\":\"ok\"}" });
          return;
        }
        if (pathKind === "flags") {
          offlinePosthogFixtures += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "{\"featureFlags\":{},\"featureFlagPayloads\":{},\"errorsWhileComputingFlags\":false}",
          });
          return;
        }
        blockedPosthogHostRequests += 1;
      }
    }
    blockedExternalRequests += 1;
    await route.abort();
  });
  currentPhase = "browser_page";
  const page = await context.newPage();
  await page.addInitScript(() => {
    // The SDK deliberately drops known bots. Present a regular-browser identity
    // for this entirely local fixture so the test can exercise its send path.
    const browserUserAgent = navigator.userAgent.replace(/HeadlessChrome/gi, "Chrome");
    Object.defineProperty(Navigator.prototype, "userAgent", { configurable: true, get: () => browserUserAgent });
    Object.defineProperty(Navigator.prototype, "webdriver", { configurable: true, get: () => false });
    Object.defineProperty(Navigator.prototype, "userAgentData", { configurable: true, get: () => undefined });
    // Observe transport invocation and the actual cookie-write boundary in the
    // browser's synchronous execution order. Route callbacks may arrive later.
    const transport = { starts: [], denialStartCount: null };
    window.__pkgcompassSmokeTransport = transport;
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    const choice = () => {
      try {
        const cookie = cookieDescriptor.get.call(document).split(";").map((part) => part.trim())
          .find((part) => part.startsWith("pkgcompass_consent_v1="));
        return cookie ? JSON.parse(decodeURIComponent(cookie.slice("pkgcompass_consent_v1=".length))).state : "unknown";
      } catch { return "unknown"; }
    };
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: cookieDescriptor.configurable,
      enumerable: cookieDescriptor.enumerable,
      get() { return cookieDescriptor.get.call(this); },
      set(value) {
        cookieDescriptor.set.call(this, value);
        if (String(value).startsWith("pkgcompass_consent_v1=")) {
          transport.denialStartCount = choice() === "denied" ? transport.starts.length : null;
        }
      },
    });
    const isPosthog = (value) => {
      try { return new URL(typeof value === "string" ? value : value.url ?? String(value), location.href).hostname.endsWith("posthog.com"); }
      catch { return false; }
    };
    const record = (kind) => transport.starts.push({ kind, consent: choice() });
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      if (isPosthog(input)) record("fetch");
      return originalFetch.call(this, input, init);
    };
    const xhrTargets = new WeakMap();
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(...args) {
      xhrTargets.set(this, isPosthog(args[1]));
      return originalOpen.apply(this, args);
    };
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(...args) {
      if (xhrTargets.get(this)) record("xhr");
      return originalSend.apply(this, args);
    };
    const originalBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function(url, data) {
      if (isPosthog(url)) record("beacon");
      return originalBeacon.call(this, url, data);
    };
  });
  const state = {
    consentGranted: false,
    preConsentRequests: 0,
    posthogRequests: 0,
    successfulPosthogResponses: 0,
    eventNames: [],
    eventsSafe: true,
    consoleErrors: 0,
    consoleErrorKinds: { network: 0, posthog: 0, other: 0 },
    pageErrors: 0,
  };
  const allowedPropertyNames = new Set([
    "token", "distinct_id", "$insert_id", "eventSchemaVersion", "environment", "routeType",
    "locale", "occurredAt", "eventId", "entityId", "comparisonId", "productId",
    "resourceType", "entryPoint", "conversionId", "scenario", "campaignKey",
  ]);

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    state.consoleErrors += 1;
    const text = message.text().toLowerCase();
    if (text.includes("posthog")) state.consoleErrorKinds.posthog += 1;
    else if (text.includes("net::err") || text.includes("failed to load resource") || text.includes("network")) {
      state.consoleErrorKinds.network += 1;
    } else state.consoleErrorKinds.other += 1;
  });
  page.on("pageerror", () => { state.pageErrors += 1; });
  function collectPosthogRequest(request) {
    state.posthogRequests += 1;
    if (!state.consentGranted) state.preConsentRequests += 1;
    for (const event of unpackPosthogEvents(request.postDataBuffer(), request.url(), request.headers()["content-encoding"])) {
      state.eventNames.push(event.event);
      const properties = event.properties && typeof event.properties === "object" ? event.properties : {};
      if (Object.keys(properties).some((key) => !allowedPropertyNames.has(key))) state.eventsSafe = false;
      if (properties.token !== expectedToken || typeof properties.distinct_id !== "string") state.eventsSafe = false;
      if (event.event === "page_viewed" && !["lead_form", "comparison"].includes(properties.routeType)) state.eventsSafe = false;
      if (event.event === "lead_form_viewed" && properties.routeType !== "lead_form") state.eventsSafe = false;
      if (event.event === "comparison_viewed" && (properties.routeType !== "comparison" ||
        properties.comparisonId !== "cmp_contentful_sanity_fixture")) state.eventsSafe = false;
    }
  }
  page.on("requestfinished", async (request) => {
    try {
      const url = new URL(request.url());
      if (url.hostname !== "eu.i.posthog.com") return;
      const response = await request.response();
      if (response && response.status() >= 200 && response.status() < 300) {
        state.successfulPosthogResponses += 1;
      }
    } catch { /* Keep browser transport errors out of output. */ }
  });

  async function requireEventCheck(condition, code) {
    if (condition) return;
    const error = Object.assign(new Error(code), { code });
    error.safeChecks = {
      posthogRequests: state.posthogRequests,
      offlinePosthogFixtureResponses: offlinePosthogFixtures,
      consoleErrors: state.consoleErrors,
      consoleErrorKinds: state.consoleErrorKinds,
      pageErrors: state.pageErrors,
      grantCookie: true,
      blockedExternalRequests,
      blockedPosthogHostRequests,
      blockedPosthogHostKinds,
      blockedPosthogPathKinds,
      eventTypes: [...new Set(state.eventNames)],
      eventsSafe: state.eventsSafe,
    };
    throw error;
  }

  async function fillForm() {
    // SSR controls are visible before hydration. Wait for React's submit handler
    // before typing so a reload cannot silently discard synthetic field edits.
    await page.waitForFunction(() => {
      const form = document.querySelector("form");
      if (!form) return false;
      return Object.keys(form).some((key) => key.startsWith("__reactProps") && typeof form[key]?.onSubmit === "function");
    });
    await page.getByLabel("Email address", { exact: true }).fill("lm08-synthetic@example.invalid");
    await page.getByLabel("What kind of site are you choosing for?", { exact: true }).selectOption("marketing_site");
    await page.getByRole("checkbox").check();
  }
  async function clickConsentButton(name) {
    await page.waitForFunction((label) => {
      const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
      return button && Object.keys(button).some((key) => key.startsWith("__reactProps") && typeof button[key]?.onClick === "function");
    }, name);
    await page.getByRole("button", { name, exact: true }).click();
  }
  async function submitFixture(fixture) {
    leadFixtures.push(fixture);
    await page.getByRole("button", { name: "Request a shortlist", exact: true }).click();
  }
  const eligibleAccepted = { status: "accepted", analyticsEligible: true, conversionId: conversionFixture };
  const conversionCount = () => state.eventNames.filter((name) => name === "lead_accepted").length;

  let failurePhase;
  try {
    currentPhase = "initial_navigation";
    const pageUrl = new URL("/en/request-shortlist/", origin);
    pageUrl.searchParams.set("utm_source", "portfolio");
    pageUrl.searchParams.set("utm_medium", "referral");
    pageUrl.searchParams.set("utm_campaign", "pkgcompass");
    pageUrl.searchParams.set("q", "synthetic-only");
    await page.goto(pageUrl.toString(), { waitUntil: "domcontentloaded" });
    currentPhase = "unknown_choice_checks";
    await page.getByRole("button", { name: "Reject analytics" }).waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    requireSafe(state.posthogRequests === 0, "posthog_request_before_choice");
    const initialStorage = await page.evaluate(() => ({
      session: Object.keys(sessionStorage).filter((key) => key.startsWith("ph_pkgcompass_") || key.startsWith("pkgcompass_")),
      local: Object.keys(localStorage).filter((key) => key.startsWith("ph_pkgcompass_") || key.startsWith("pkgcompass_")),
    }));
    requireSafe(initialStorage.session.length === 0 && initialStorage.local.length === 0, "optional_storage_before_choice");

    currentPhase = "no_consent_form_accepted";
    await fillForm();
    await submitFixture({ body: eligibleAccepted });
    await page.getByRole("heading", { name: "Your request is saved." }).waitFor();
    requireSafe(state.posthogRequests === 0, "no_consent_accepted_sent_analytics");
    const noConsentStorageCount = await page.evaluate(() => sessionStorage.length + localStorage.length);
    requireSafe(noConsentStorageCount === 0, "no_consent_accepted_persisted_storage");
    await page.reload({ waitUntil: "domcontentloaded" });

    currentPhase = "denied_reload_checks";
    await clickConsentButton("Reject analytics");
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    requireSafe(state.posthogRequests === 0, "posthog_request_while_denied");
    const deniedCookieNames = (await context.cookies()).map((cookie) => cookie.name);
    requireSafe(deniedCookieNames.includes("pkgcompass_consent_v1"), "denied_consent_not_persisted");

    currentPhase = "failure_and_lost_response_retry";
    await fillForm();
    await submitFixture({ status: 503, body: { status: "unavailable" } });
    await page.getByRole("alert").filter({ hasText: "We could not confirm your request. Please retry." }).waitFor();
    const failedRequestId = leadAttempts.at(-1).requestId;
    // Permission is mandatory but toggling it must not change operation identity.
    await page.getByRole("checkbox").uncheck();
    await page.getByRole("checkbox").check();
    await submitFixture({ abort: true });
    await page.getByRole("alert").filter({ hasText: "We could not confirm your request. Please retry." }).waitFor();
    requireSafe(leadAttempts.at(-1).requestId === failedRequestId, "permission_toggle_changed_retry_identity");
    await submitFixture({ body: eligibleAccepted });
    await page.getByRole("heading", { name: "Your request is saved." }).waitFor();
    requireSafe(leadAttempts.at(-1).requestId === failedRequestId, "lost_response_changed_retry_identity");
    requireSafe(state.posthogRequests === 0, "denied_retry_sent_analytics");

    currentPhase = "honeypot_form_projection";
    await page.reload({ waitUntil: "domcontentloaded" });
    currentPhase = "honeypot_fill";
    await fillForm();
    currentPhase = "honeypot_set";
    await page.locator("#shortlist-website").evaluate((input) => { input.value = "synthetic-honeypot"; });
    currentPhase = "honeypot_submit";
    await submitFixture({ body: { status: "accepted", analyticsEligible: false } });
    currentPhase = "honeypot_accepted";
    await page.waitForTimeout(300);
    requireSafe(leadFixtures.length === 0, "honeypot_submit_not_dispatched");
    requireSafe(!(await page.getByRole("alert").textContent())?.includes("Check the highlighted"), "honeypot_client_validation_error");
    await page.getByRole("heading", { name: "Your request is saved." }).waitFor();
    requireSafe(leadAttempts.at(-1).website === "synthetic-honeypot", "honeypot_not_forwarded");
    requireSafe(state.posthogRequests === 0, "honeypot_sent_analytics");

    currentPhase = "grant_and_direct_reload";
    await clickConsentButton("Privacy settings");
    state.consentGranted = true;
    await clickConsentButton("Accept analytics");
    await page.waitForFunction(() => {
      const item = document.cookie.split(";").map((part) => part.trim())
        .find((part) => part.startsWith("pkgcompass_consent_v1="));
      if (!item) return false;
      try {
        const value = JSON.parse(decodeURIComponent(item.slice("pkgcompass_consent_v1=".length)));
        return value?.state === "granted" && value?.policyVersion === 1;
      } catch { return false; }
    }, null, { timeout: 5_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Privacy settings" }).waitFor({ state: "visible" });
    currentPhase = "granted_event_checks";
    await page.waitForTimeout(2_000);
    if (state.posthogRequests === 0) {
      const sdkDiagnostics = await page.evaluate(() => {
        const client = window.posthog;
        const isCallable = (value) => typeof value === "function";
        let optedIn = false;
        let hostMatches = false;
        try { optedIn = isCallable(client?.has_opted_in_capturing) && client.has_opted_in_capturing(); } catch { /* Boolean only. */ }
        try { hostMatches = isCallable(client?.get_config) && client.get_config("api_host") === "https://eu.i.posthog.com"; } catch { /* Boolean only. */ }
        return {
          clientPresent: Boolean(client),
          loaded: Boolean(client?.__loaded),
          optedIn,
          hostMatches,
          grantedStorageCount: [sessionStorage, localStorage].reduce(
            (count, storage) => count + Object.keys(storage).filter((key) => key.startsWith("ph_pkgcompass_analytics_v1")).length,
            0,
          ),
        };
      });
      throw Object.assign(new Error("posthog_event_missing_after_grant"), {
        code: "posthog_event_missing_after_grant",
        safeChecks: {
          posthogRequests: state.posthogRequests,
          offlinePosthogFixtureResponses: offlinePosthogFixtures,
          consoleErrors: state.consoleErrors,
          consoleErrorKinds: state.consoleErrorKinds,
          pageErrors: state.pageErrors,
          grantCookie: await page.evaluate(() => {
            const item = document.cookie.split(";").map((part) => part.trim())
              .find((part) => part.startsWith("pkgcompass_consent_v1="));
            if (!item) return false;
            try { return JSON.parse(decodeURIComponent(item.slice("pkgcompass_consent_v1=".length))).state === "granted"; }
            catch { return false; }
          }),
          blockedExternalRequests,
          blockedPosthogHostRequests,
          blockedPosthogHostKinds,
          blockedPosthogPathKinds,
          sdkDiagnostics,
          eventTypes: [...new Set(state.eventNames)],
        },
      });
    }
    requireSafe(state.successfulPosthogResponses > 0 && offlinePosthogFixtures > 0, "offline_posthog_fixture_missing");
    await requireEventCheck(state.eventNames.includes("page_viewed"), "page_viewed_missing");
    await requireEventCheck(state.eventNames.includes("lead_form_viewed"), "lead_form_viewed_missing_on_granted_load");
    await requireEventCheck(state.eventsSafe, "posthog_event_allowlist_failed");

    currentPhase = "granted_comparison_to_form_journey";
    // Read the published development page; form responses and analytics stay
    // offline fixtures. This validates browser wiring, not live CRM integration.
    await page.goto(new URL("/en/compare/contentful-vs-sanity/", origin).toString(), { waitUntil: "domcontentloaded" });
    const comparisonCta = page.getByRole("link", { name: "Ask for help choosing between these CMS options", exact: true });
    await comparisonCta.waitFor({ state: "visible" });
    for (let attempt = 0; attempt < 20 && !state.eventNames.includes("comparison_viewed"); attempt += 1) {
      await page.waitForTimeout(100);
    }
    await requireEventCheck(state.eventNames.includes("comparison_viewed"), "comparison_viewed_missing_on_granted_visit");
    const comparisonEventIndex = state.eventNames.lastIndexOf("comparison_viewed");
    await comparisonCta.click();
    await page.getByRole("heading", { name: "Request a CMS shortlist", exact: true }).waitFor();
    await fillForm();
    requireSafe(await page.locator("[data-entry-point]").getAttribute("data-entry-point") === "comparison", "comparison_cta_entrypoint_lost");

    currentPhase = "granted_accepted_conversion";
    requireSafe(conversionCount() === 0, "historical_accepted_replayed_after_grant");
    await fillForm();
    await submitFixture({ status: 503, body: { status: "unavailable" } });
    await page.getByRole("alert").filter({ hasText: "We could not confirm your request. Please retry." }).waitFor();
    requireSafe(conversionCount() === 0, "granted_failure_created_conversion");
    await submitFixture({ body: eligibleAccepted });
    await page.getByRole("heading", { name: "Your request is saved." }).waitFor();
    await page.waitForTimeout(300);
    requireSafe(conversionCount() === 1, "granted_conversion_not_once");
    const formEventIndex = state.eventNames.findIndex((name, index) => index > comparisonEventIndex && name === "lead_form_viewed");
    const acceptedEventIndex = state.eventNames.indexOf("lead_accepted");
    requireSafe(formEventIndex > comparisonEventIndex && acceptedEventIndex > formEventIndex, "comparison_form_accepted_order_failed");
    await requireEventCheck(state.eventsSafe, "comparison_journey_event_allowlist_failed");
    await page.reload({ waitUntil: "domcontentloaded" });
    await fillForm();
    await submitFixture({ body: eligibleAccepted });
    await page.getByRole("heading", { name: "Your request is saved." }).waitFor();
    await page.waitForTimeout(300);
    requireSafe(conversionCount() === 1, "retry_conversion_duplicated");
    await page.reload({ waitUntil: "domcontentloaded" });
    await fillForm();
    await submitFixture({ body: { status: "accepted", analyticsEligible: false } });
    await page.getByRole("heading", { name: "Your request is saved." }).waitFor();
    await page.waitForTimeout(300);
    requireSafe(conversionCount() === 1, "neutral_duplicate_created_conversion");

    currentPhase = "late_success_after_withdrawal";
    await page.reload({ waitUntil: "domcontentloaded" });
    await fillForm();
    let releaseLateResponse;
    let startedLateResponse;
    const lateStarted = new Promise((resolve) => { startedLateResponse = resolve; });
    const release = new Promise((resolve) => { releaseLateResponse = resolve; });
    leadFixtures.push({ body: { ...eligibleAccepted, conversionId: "22222222-2222-4222-8222-222222222222" }, release, started: startedLateResponse });
    await page.getByRole("button", { name: "Request a shortlist", exact: true }).click();
    await lateStarted;

    currentPhase = "withdrawal_checks";
    await clickConsentButton("Privacy settings");
    await clickConsentButton("Reject analytics");
    state.consentGranted = false;
    const withdrawalBoundary = await page.evaluate(() => ({ ...window.__pkgcompassSmokeTransport, starts: [...window.__pkgcompassSmokeTransport.starts] }));
    requireSafe(withdrawalBoundary.denialStartCount !== null, "actual_denial_boundary_missing");
    const beforeWithdrawal = state.posthogRequests;
    releaseLateResponse();
    await page.getByRole("heading", { name: "Your request is saved." }).waitFor();
    await page.waitForTimeout(300);
    const withdrawnStorage = await page.evaluate(() => {
      const optional = (storage) => Object.keys(storage).filter((key) =>
        key.startsWith("ph_pkgcompass_analytics_v1") ||
        key.startsWith("pkgcompass_campaign_v1") ||
        key.startsWith("pkgcompass_conversion_ids_v1"),
      );
      return { session: optional(sessionStorage), local: optional(localStorage) };
    });
    const withdrawnCookieNames = (await context.cookies()).map((cookie) => cookie.name);
    requireSafe(withdrawnStorage.session.length === 0 && withdrawnStorage.local.length === 0, "analytics_storage_not_cleared");
    requireSafe(
      withdrawnCookieNames.length === 1 && withdrawnCookieNames[0] === "pkgcompass_consent_v1",
      "optional_cookie_not_cleared",
    );
    const afterWithdrawal = await page.evaluate(() => window.__pkgcompassSmokeTransport);
    requireSafe(afterWithdrawal.starts.length === afterWithdrawal.denialStartCount, "posthog_transport_started_after_actual_denial");
    const grantedInFlightCallbacks = state.posthogRequests - beforeWithdrawal;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const deniedReload = await page.evaluate(() => window.__pkgcompassSmokeTransport);
    requireSafe(deniedReload.starts.length === 0, "posthog_transport_started_on_denied_reload");
    requireSafe(conversionCount() === 1, "late_success_created_conversion_after_withdrawal");
    // One intentional abort models a lost API response; Chromium may report it
    // as a network console error. Script/runtime and SDK errors remain fatal.
    requireSafe(state.consoleErrorKinds.other === 0 && state.consoleErrorKinds.posthog === 0 && state.pageErrors === 0, "browser_console_error");
    requireSafe(!unexpectedLeadRequest && leadFixtures.length === 0, "unexpected_unfulfilled_lead_fixture");
    requireSafe(blockedExternalRequests === 0, "unexpected_external_browser_request");

    currentPhase = "blocked_analytics_does_not_break_form";
    blockAnalyticsTransport = true;
    await clickConsentButton("Privacy settings");
    state.consentGranted = true;
    await clickConsentButton("Accept analytics");
    await page.reload({ waitUntil: "domcontentloaded" });
    await fillForm();
    await submitFixture({ body: { ...eligibleAccepted, conversionId: "33333333-3333-4333-8333-333333333333" } });
    await page.getByRole("heading", { name: "Your request is saved." }).waitFor();
    await page.waitForTimeout(300);
    requireSafe(intentionallyBlockedAnalyticsRequests > 0, "blocked_analytics_scenario_not_exercised");
    requireSafe(!unexpectedLeadRequest && leadFixtures.length === 0 && state.pageErrors === 0, "blocked_analytics_broke_form");
    await clickConsentButton("Privacy settings");
    await clickConsentButton("Reject analytics");
    state.consentGranted = false;
    emit("pass", "posthog_browser_consent_lifecycle", {
      transport: "offline_fixture",
      preConsentRequests: 0,
      posthogRequestsAfterGrant: beforeWithdrawal,
      offlinePosthogFixtureResponses: offlinePosthogFixtures,
      acceptedEventTypes: [...new Set(state.eventNames)],
      storageClearedOnWithdrawal: true,
      denialBoundary: "synchronous_consent_cookie_write",
      transportStartsAfterDenial: afterWithdrawal.starts.length - afterWithdrawal.denialStartCount,
      alreadyGrantedCallbacksAfterDenial: grantedInFlightCallbacks,
      transportStartsOnDeniedReload: deniedReload.starts.length,
      reloadStayedDenied: true,
      leadTransport: "offline_fixture",
      noConsentAccepted: true,
      failedAndLostResponseRetryStable: true,
      honeypotForwarded: true,
      eligibleConversions: conversionCount(),
      neutralDuplicateExcluded: true,
      lateSuccessAfterWithdrawalExcluded: true,
      grantedFailureExcluded: true,
      acceptedWithBlockedAnalytics: true,
      comparisonCtaJourneyOrdered: true,
    });
  } catch (error) {
    failurePhase = currentPhase;
    throw error;
  } finally {
    currentPhase = "browser_cleanup";
    await context.clearCookies().catch(() => undefined);
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    if (failurePhase) currentPhase = failurePhase;
  }
}

main().catch((error) => {
  const errorCode = error && typeof error.code === "string" && /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(error.code)
    ? error.code
    : "unclassified";
  const errorType = error && typeof error.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(error.name)
    ? error.name
    : "Error";
  const extraChecks = error?.safeChecks && typeof error.safeChecks === "object"
    ? {
        posthogRequests: Number.isSafeInteger(error.safeChecks.posthogRequests) ? error.safeChecks.posthogRequests : 0,
        offlinePosthogFixtureResponses: Number.isSafeInteger(error.safeChecks.offlinePosthogFixtureResponses) ? error.safeChecks.offlinePosthogFixtureResponses : 0,
        consoleErrors: Number.isSafeInteger(error.safeChecks.consoleErrors) ? error.safeChecks.consoleErrors : 0,
        consoleErrorKinds: error.safeChecks.consoleErrorKinds && typeof error.safeChecks.consoleErrorKinds === "object"
          ? {
              network: Number.isSafeInteger(error.safeChecks.consoleErrorKinds.network) ? error.safeChecks.consoleErrorKinds.network : 0,
              posthog: Number.isSafeInteger(error.safeChecks.consoleErrorKinds.posthog) ? error.safeChecks.consoleErrorKinds.posthog : 0,
              other: Number.isSafeInteger(error.safeChecks.consoleErrorKinds.other) ? error.safeChecks.consoleErrorKinds.other : 0,
            }
          : { network: 0, posthog: 0, other: 0 },
        pageErrors: Number.isSafeInteger(error.safeChecks.pageErrors) ? error.safeChecks.pageErrors : 0,
        grantCookie: error.safeChecks.grantCookie === true,
        blockedExternalRequests: Number.isSafeInteger(error.safeChecks.blockedExternalRequests) ? error.safeChecks.blockedExternalRequests : 0,
        blockedPosthogHostRequests: Number.isSafeInteger(error.safeChecks.blockedPosthogHostRequests) ? error.safeChecks.blockedPosthogHostRequests : 0,
        blockedPosthogHostKinds: error.safeChecks.blockedPosthogHostKinds && typeof error.safeChecks.blockedPosthogHostKinds === "object"
          ? {
              expectedEu: Number.isSafeInteger(error.safeChecks.blockedPosthogHostKinds.expectedEu) ? error.safeChecks.blockedPosthogHostKinds.expectedEu : 0,
              euAssets: Number.isSafeInteger(error.safeChecks.blockedPosthogHostKinds.euAssets) ? error.safeChecks.blockedPosthogHostKinds.euAssets : 0,
              euAlias: Number.isSafeInteger(error.safeChecks.blockedPosthogHostKinds.euAlias) ? error.safeChecks.blockedPosthogHostKinds.euAlias : 0,
              otherPosthog: Number.isSafeInteger(error.safeChecks.blockedPosthogHostKinds.otherPosthog) ? error.safeChecks.blockedPosthogHostKinds.otherPosthog : 0,
            }
          : { expectedEu: 0, euAssets: 0, euAlias: 0, otherPosthog: 0 },
        blockedPosthogPathKinds: error.safeChecks.blockedPosthogPathKinds && typeof error.safeChecks.blockedPosthogPathKinds === "object"
          ? {
              event: Number.isSafeInteger(error.safeChecks.blockedPosthogPathKinds.event) ? error.safeChecks.blockedPosthogPathKinds.event : 0,
              ingestion: Number.isSafeInteger(error.safeChecks.blockedPosthogPathKinds.ingestion) ? error.safeChecks.blockedPosthogPathKinds.ingestion : 0,
              flags: Number.isSafeInteger(error.safeChecks.blockedPosthogPathKinds.flags) ? error.safeChecks.blockedPosthogPathKinds.flags : 0,
              remoteConfig: Number.isSafeInteger(error.safeChecks.blockedPosthogPathKinds.remoteConfig) ? error.safeChecks.blockedPosthogPathKinds.remoteConfig : 0,
              other: Number.isSafeInteger(error.safeChecks.blockedPosthogPathKinds.other) ? error.safeChecks.blockedPosthogPathKinds.other : 0,
            }
          : { event: 0, ingestion: 0, flags: 0, remoteConfig: 0, other: 0 },
        sdkDiagnostics: error.safeChecks.sdkDiagnostics && typeof error.safeChecks.sdkDiagnostics === "object"
          ? {
              clientPresent: error.safeChecks.sdkDiagnostics.clientPresent === true,
              loaded: error.safeChecks.sdkDiagnostics.loaded === true,
              optedIn: error.safeChecks.sdkDiagnostics.optedIn === true,
              hostMatches: error.safeChecks.sdkDiagnostics.hostMatches === true,
              grantedStorageCount: Number.isSafeInteger(error.safeChecks.sdkDiagnostics.grantedStorageCount)
                ? error.safeChecks.sdkDiagnostics.grantedStorageCount
                : 0,
            }
          : { clientPresent: false, loaded: false, optedIn: false, hostMatches: false, grantedStorageCount: 0 },
        eventTypes: Array.isArray(error.safeChecks.eventTypes)
          ? error.safeChecks.eventTypes.filter((event) => ["page_viewed", "comparison_viewed", "lead_form_viewed", "lead_accepted", "official_resource_clicked"].includes(event))
          : [],
        eventsSafe: error.safeChecks.eventsSafe === true,
      }
    : undefined;
  emit("fail", `browser_${currentPhase}_failed`, { phase: currentPhase, transport: "offline_fixture", errorType, errorCode, ...(extraChecks ? { diagnostics: extraChecks } : {}) });
  process.exitCode = 1;
});
