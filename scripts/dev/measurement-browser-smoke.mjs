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
  await context.route("**/*", async (route) => {
    let requestUrl;
    try { requestUrl = new URL(route.request().url()); } catch {
      blockedExternalRequests += 1;
      await route.abort();
      return;
    }
    if (requestUrl.origin === origin) {
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
      if (event.event === "page_viewed" && properties.routeType !== "lead_form") state.eventsSafe = false;
      if (event.event === "lead_form_viewed" && properties.routeType !== "lead_form") state.eventsSafe = false;
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

    currentPhase = "denied_reload_checks";
    await page.getByRole("button", { name: "Reject analytics" }).click();
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    requireSafe(state.posthogRequests === 0, "posthog_request_while_denied");
    const deniedCookieNames = (await context.cookies()).map((cookie) => cookie.name);
    requireSafe(deniedCookieNames.includes("pkgcompass_consent_v1"), "denied_consent_not_persisted");

    currentPhase = "grant_and_direct_reload";
    await page.getByRole("button", { name: "Privacy settings" }).click();
    state.consentGranted = true;
    await page.getByRole("button", { name: "Accept analytics" }).click();
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

    currentPhase = "withdrawal_checks";
    const beforeWithdrawal = state.posthogRequests;
    await page.getByRole("button", { name: "Privacy settings" }).click();
    await page.getByRole("button", { name: "Reject analytics" }).click();
    state.consentGranted = false;
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
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    requireSafe(state.posthogRequests === beforeWithdrawal, "posthog_request_after_withdrawal");
    requireSafe(state.consoleErrors === 0 && state.pageErrors === 0, "browser_console_error");
    requireSafe(blockedExternalRequests === 0, "unexpected_external_browser_request");
    emit("pass", "posthog_browser_consent_lifecycle", {
      transport: "offline_fixture",
      preConsentRequests: 0,
      posthogRequestsAfterGrant: beforeWithdrawal,
      offlinePosthogFixtureResponses: offlinePosthogFixtures,
      acceptedEventTypes: [...new Set(state.eventNames)],
      storageClearedOnWithdrawal: true,
      reloadStayedDenied: true,
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
