import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@sanity/client";
import { SIGNATURE_HEADER_NAME, isValidSignature } from "@sanity/webhook";
import { SafeConfigurationError } from "../src/server/config/environment";
import { productContentDocumentId } from "../src/domain/cms-document-ids";
import { selectComponentTarget } from "../src/server/config/targets";

const BASE_URL = "http://127.0.0.1:3000";
const PRODUCT_PATH = "/en/tools/sanity/";
const PREVIEW_COOKIE = "pkgcompass_preview";
const BYPASS_COOKIE = "__prerender_bypass";
interface SmokeArgs {
  readonly environment: "development";
  readonly manifestPath: string;
  readonly reportPath: string;
}

class SafeRuntimeSmokeError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "SafeRuntimeSmokeError"; this.code = code; }
}

function loadLocalEnvironment(): void {
  try {
    const require = createRequire(import.meta.url);
    const { loadEnvConfig } = require("@next/env") as { loadEnvConfig: (directory: string, dev: boolean, logger?: { info(): void; error(): void }) => unknown };
    loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  } catch {
    throw new SafeRuntimeSmokeError("smoke_environment_load_failed");
  }
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new SafeRuntimeSmokeError(code);
}

export function parseLocalCmsSmokeArgs(argv: readonly string[]): SmokeArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== "--env" && flag !== "--manifest-path" && flag !== "--report-path") || !value || value.startsWith("--") || values.has(flag)) {
      throw new SafeRuntimeSmokeError("smoke_arguments_invalid");
    }
    values.set(flag, value);
    index += 1;
  }
  if (values.get("--env") !== "development") throw new SafeRuntimeSmokeError("smoke_development_scope_required");
  const reportArgument = values.get("--report-path");
  if (!reportArgument) throw new SafeRuntimeSmokeError("smoke_report_path_required");
  const artifactsRoot = resolve("artifacts/runs");
  const manifestArgument = values.get("--manifest-path");
  if (!manifestArgument) throw new SafeRuntimeSmokeError("smoke_manifest_path_required");
  const manifestPath = resolve(manifestArgument);
  const reportPath = resolve(reportArgument);
  if (!manifestPath.startsWith(`${artifactsRoot}/`) || !manifestPath.endsWith(".json") ||
    !reportPath.startsWith(`${artifactsRoot}/`) || !reportPath.endsWith(".json")) {
    throw new SafeRuntimeSmokeError("smoke_report_path_invalid");
  }
  return { environment: "development", manifestPath, reportPath };
}

function setCookieHeaders(response: Response): readonly string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = response.headers.get("set-cookie");
  return combined ? combined.split(/, (?=[^;,]+=)/) : [];
}

function cookiePairs(headers: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const header of headers) {
    const pair = header.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (separator > 0 && pair) result.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return result;
}

export function clearedCookieNames(headers: readonly string[]): Set<string> {
  const cleared = new Set<string>();
  for (const header of headers) {
    const pair = header.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (separator <= 0 || !pair) continue;
    const attributes = header.split(";").slice(1).map((attribute) => attribute.trim());
    const maxAgeAttribute = attributes.find((attribute) => /^max-age=/i.test(attribute));
    const maxAge = maxAgeAttribute ? Number(maxAgeAttribute.slice(maxAgeAttribute.indexOf("=") + 1)) : undefined;
    const expiresAttribute = attributes.find((attribute) => /^expires=/i.test(attribute));
    const expiry = expiresAttribute ? Date.parse(expiresAttribute.slice(expiresAttribute.indexOf("=") + 1)) : Number.NaN;
    if (maxAge === 0 || (Number.isFinite(expiry) && expiry <= Date.now())) {
      cleared.add(pair.slice(0, separator));
    }
  }
  return cleared;
}

function cookieHeader(cookies: ReadonlyMap<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function signedWebhookHeader(body: string, secret: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64url");
  return `t=${timestamp},v1=${digest}`;
}

async function saveSanitizedReport(destination: string, report: unknown): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(report)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

export async function runLocalCmsSmoke() {
  const args = parseLocalCmsSmokeArgs(process.argv.slice(2));
  loadLocalEnvironment();
  const configuredAppEnv = process.env.APP_ENV?.trim();
  assert(!configuredAppEnv || configuredAppEnv === args.environment, "smoke_app_env_mismatch");
  process.env.APP_ENV = "development";
  const content = selectComponentTarget("content");
  const preview = selectComponentTarget("preview");
  const seed = selectComponentTarget("seed");
  const webhook = selectComponentTarget("webhook");
  assert(content.mode === "live" && preview.mode === "live" && seed.mode === "live" && webhook.mode === "live", "smoke_development_adapters_unavailable");
  assert(content.settings.SANITY_PROJECT_ID === process.env.SANITY_STUDIO_PROJECT_ID && content.settings.SANITY_DATASET === process.env.SANITY_STUDIO_DATASET, "smoke_studio_target_mismatch");

  const report: Record<string, unknown> = {
    environment: "development",
    target: BASE_URL,
    preview: {},
    webhook: {},
    temporaryPreviewSecretCreated: false,
    temporaryPreviewSecretDeleted: false,
  };
  let manifestDraftRevision: string | undefined;
  try {
    const manifest: unknown = JSON.parse(await readFile(args.manifestPath, "utf8"));
    if (manifest !== null && typeof manifest === "object" && Array.isArray((manifest as Record<string, unknown>).documents)) {
      const entry = ((manifest as { documents: unknown[] }).documents).find((value) => value !== null && typeof value === "object" && (value as Record<string, unknown>).id === productContentDocumentId("prd_sanity"));
      if (entry !== null && typeof entry === "object" && (entry as Record<string, unknown>).type === "productContent" && typeof (entry as Record<string, unknown>).draftRevision === "string") {
        manifestDraftRevision = (entry as { draftRevision: string }).draftRevision;
      }
    }
  } catch {
    throw new SafeRuntimeSmokeError("smoke_manifest_invalid");
  }
  assert(manifestDraftRevision, "smoke_manifest_invalid");
  const client = createClient({
    projectId: content.settings.SANITY_PROJECT_ID,
    dataset: content.settings.SANITY_DATASET,
    apiVersion: content.settings.SANITY_API_VERSION,
    token: seed.settings.SANITY_SEED_WRITE_TOKEN,
    useCdn: false,
    timeout: 8_000,
    maxRetries: 0,
  });
  const secretDocumentId = `drafts.${randomUUID()}`;
  let previewSecretForCleanup: string | undefined;
  let secretDocumentRevision: string | undefined;
  let originalDraftSummary: string | undefined;
  let draftSentinelRevision: string | undefined;
  let draftSentinelApplied = false;
  const draftContentId = `drafts.${productContentDocumentId("prd_sanity")}`;
  const rawClient = client.withConfig({ perspective: "raw" });
  try {
    const beforeHome = await fetch(new URL("/en/", BASE_URL), { signal: AbortSignal.timeout(15_000) });
    const beforeProduct = await fetch(new URL(PRODUCT_PATH, BASE_URL), { signal: AbortSignal.timeout(15_000) });
    const beforeComparison = await fetch(new URL("/en/compare/contentful-vs-sanity/", BASE_URL), { signal: AbortSignal.timeout(15_000) });
    report.publicRoutesBeforeWebhook = { homeStatus: beforeHome.status, productStatus: beforeProduct.status, comparisonStatus: beforeComparison.status };

    const invalidSignature = await fetch(`${BASE_URL}/api/revalidate/`, {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE_HEADER_NAME]: `t=${Date.now()},v1=invalid` },
      body: JSON.stringify({ schemaVersion: 1, environment: "development", dataset: content.settings.SANITY_DATASET, documentId: "prd_sanity", documentType: "product" }),
      signal: AbortSignal.timeout(15_000),
    });
    assert(invalidSignature.status === 401, "smoke_webhook_invalid_signature_not_rejected");

    const webhookPayload = JSON.stringify({ schemaVersion: 1, environment: "development", dataset: content.settings.SANITY_DATASET, documentId: "prd_sanity", documentType: "product" });
    const signedHeader = signedWebhookHeader(webhookPayload, webhook.settings.SANITY_WEBHOOK_SECRET, Date.now());
    assert(await isValidSignature(webhookPayload, signedHeader, webhook.settings.SANITY_WEBHOOK_SECRET), "smoke_webhook_signature_generation_invalid");
    const postSignedWebhook = () => fetch(`${BASE_URL}/api/revalidate/`, {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE_HEADER_NAME]: signedHeader },
      body: webhookPayload,
      signal: AbortSignal.timeout(15_000),
    });
    const validWebhook = await postSignedWebhook();
    assert(validWebhook.status === 200, "smoke_webhook_signed_request_failed");
    const replayWebhook = await postSignedWebhook();
    assert(replayWebhook.status === 200, "smoke_webhook_replay_failed");

    const afterHome = await fetch(new URL("/en/", BASE_URL), { signal: AbortSignal.timeout(15_000) });
    const afterHomeHtml = await afterHome.text();
    const afterProduct = await fetch(new URL(PRODUCT_PATH, BASE_URL), { signal: AbortSignal.timeout(15_000) });
    const afterComparison = await fetch(new URL("/en/compare/contentful-vs-sanity/", BASE_URL), { signal: AbortSignal.timeout(15_000) });
    const publicRoutesAfterWebhook = {
      homeStatus: afterHome.status,
      productStatus: afterProduct.status,
      comparisonStatus: afterComparison.status,
      homeShowsPublishedCmsFixture: afterHomeHtml.includes("Sanity") && afterHomeHtml.includes("Contentful"),
    };
    assert(publicRoutesAfterWebhook.homeStatus === 200 && publicRoutesAfterWebhook.productStatus === 200 &&
      publicRoutesAfterWebhook.comparisonStatus === 200 && publicRoutesAfterWebhook.homeShowsPublishedCmsFixture,
    "smoke_public_routes_not_refreshed_after_webhook");
    report.publicRoutesAfterWebhook = publicRoutesAfterWebhook;
    report.webhook = {
      invalidSignatureStatus: invalidSignature.status,
      validSignatureStatus: validWebhook.status,
      exactReplayStatus: replayWebhook.status,
      replayIsIdempotentCacheInvalidation: true,
    };

    const invalidEnable = await fetch(`${BASE_URL}/api/preview/enable/`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const invalidEnableCookies = setCookieHeaders(invalidEnable);
    assert(invalidEnable.status === 401 && invalidEnableCookies.length === 0, "smoke_preview_missing_secret_not_denied");
    report.preview = { missingSecretStatus: invalidEnable.status, missingSecretSetCookie: false };

    const previewSecret = randomBytes(24).toString("base64url");
    previewSecretForCleanup = previewSecret;
    const createdSecret = await client.create({
      _id: secretDocumentId,
      _type: "sanity.previewUrlSecret",
      secret: previewSecret,
      source: "pkgcompass-development-runtime-smoke",
      studioUrl: BASE_URL,
    });
    assert(typeof createdSecret._rev === "string", "smoke_preview_secret_revision_missing");
    secretDocumentRevision = createdSecret._rev;
    report.temporaryPreviewSecretCreated = true;

    const enableUrl = new URL("/api/preview/enable/", BASE_URL);
    enableUrl.searchParams.set("sanity-preview-secret", previewSecret);
    enableUrl.searchParams.set("sanity-preview-pathname", PRODUCT_PATH);
    const enable = await fetch(enableUrl, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const enableHeaders = setCookieHeaders(enable);
    const enableCookies = cookiePairs(enableHeaders);
    const location = enable.headers.get("location");
    assert(enable.status === 307 && location && new URL(location, BASE_URL).pathname === PRODUCT_PATH, "smoke_preview_enable_redirect_failed");
    assert(enableCookies.has(PREVIEW_COOKIE) && enableCookies.has(BYPASS_COOKIE), "smoke_preview_enable_cookie_missing");
    const previewSessionHeader = enableHeaders.find((header) => header.startsWith(`${PREVIEW_COOKIE}=`)) ?? "";
    assert(/; *httponly/i.test(previewSessionHeader), "smoke_preview_session_not_http_only");
    report.preview = {
      ...(report.preview as object),
      validEnableStatus: enable.status,
      redirectPathAllowed: true,
      previewCookieIssued: true,
      previewCookieHttpOnly: true,
    };

    const previewPage = await fetch(new URL(PRODUCT_PATH, BASE_URL), { headers: { cookie: cookieHeader(enableCookies) }, signal: AbortSignal.timeout(15_000) });
    let previewHtml = await previewPage.text();
    const privatePreviewRendered = previewHtml.includes("Private draft preview") && previewHtml.includes("noindex");
    assert(previewPage.status === 200 && privatePreviewRendered, "smoke_authenticated_draft_preview_failed");

    const draftContentRaw: unknown = await rawClient.fetch<unknown>(
      "*[_id == $id][0]{_id,_type,_rev,summary}",
      { id: draftContentId },
      { timeout: 8_000 },
    );
    const draftContent = draftContentRaw !== null && typeof draftContentRaw === "object" && !Array.isArray(draftContentRaw)
      ? draftContentRaw as Record<string, unknown> : undefined;
    assert(draftContent?._id === draftContentId && draftContent._type === "productContent" &&
      draftContent._rev === manifestDraftRevision && typeof draftContent.summary === "string" && draftContent.summary.length <= 500,
    "smoke_draft_sentinel_identity_mismatch");
    originalDraftSummary = draftContent.summary as string;
    const sentinelSummary = "Synthetic preview-only isolation sentinel.";
    const sentinelResult = await client.transaction()
      .patch(draftContentId, (patch) => patch.ifRevisionId(manifestDraftRevision!).set({ summary: sentinelSummary }))
      .commit({ returnDocuments: true, returnFirst: true });
    assert(sentinelResult?._id === draftContentId && typeof sentinelResult._rev === "string", "smoke_draft_sentinel_write_failed");
    draftSentinelRevision = sentinelResult._rev;
    draftSentinelApplied = true;

    const sentinelPreview = await fetch(new URL(PRODUCT_PATH, BASE_URL), { headers: { cookie: cookieHeader(enableCookies) }, signal: AbortSignal.timeout(15_000) });
    previewHtml = await sentinelPreview.text();
    assert(sentinelPreview.status === 200 && previewHtml.includes(sentinelSummary), "smoke_preview_draft_sentinel_not_visible");
    const sentinelPublic = await fetch(new URL(PRODUCT_PATH, BASE_URL), { signal: AbortSignal.timeout(15_000) });
    const sentinelPublicHtml = await sentinelPublic.text();
    assert(sentinelPublic.status === 200 && !sentinelPublicHtml.includes(sentinelSummary), "smoke_public_route_exposed_draft_sentinel");
    report.preview = {
      ...(report.preview as object),
      authenticatedDraftStatus: previewPage.status,
      authenticatedDraftNoindexMarker: true,
      previewDraftSentinelVisible: true,
      publicDraftSentinelAbsent: true,
      htmlOrDraftTextPersisted: false,
    };

    const publicPage = await fetch(new URL(PRODUCT_PATH, BASE_URL), { signal: AbortSignal.timeout(15_000) });
    const publicHtml = await publicPage.text();
    assert(publicPage.status === 200 && !publicHtml.includes("Private draft preview"), "smoke_public_request_entered_preview");
    const forgedCookies = new Map(enableCookies);
    forgedCookies.set(PREVIEW_COOKIE, "invalid-session");
    const forgedPage = await fetch(new URL(PRODUCT_PATH, BASE_URL), { headers: { cookie: cookieHeader(forgedCookies) }, signal: AbortSignal.timeout(15_000) });
    const forgedHtml = await forgedPage.text();
    assert(forgedPage.status === 200 && !forgedHtml.includes("Private draft preview"), "smoke_forged_preview_session_accepted");
    report.preview = {
      ...(report.preview as object),
      publicStatus: publicPage.status,
      publicRequestStayedPublished: true,
      forgedSessionStatus: forgedPage.status,
      forgedSessionStayedPublished: true,
    };

    const disable = await fetch(`${BASE_URL}/api/preview/disable/`, { headers: { cookie: cookieHeader(enableCookies) }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const disableHeaders = setCookieHeaders(disable);
    const clearedNames = clearedCookieNames(disableHeaders);
    report.preview = {
      ...(report.preview as object),
      disableStatus: disable.status,
      previewCookieCleared: clearedNames.has(PREVIEW_COOKIE),
      draftModeCookieCleared: clearedNames.has(BYPASS_COOKIE),
    };
    assert(disable.status === 307 && clearedNames.has(PREVIEW_COOKIE) && clearedNames.has(BYPASS_COOKIE), "smoke_preview_disable_failed");

  } catch (error) {
    const code = error instanceof SafeRuntimeSmokeError ? error.code : "smoke_request_failed";
    report.outcome = "fail";
    report.failureCode = code;
  } finally {
    if (draftSentinelApplied && originalDraftSummary !== undefined && draftSentinelRevision) {
      try {
        const currentDraftRaw: unknown = await rawClient.fetch<unknown>(
          "*[_id == $id][0]{_id,_type,_rev,summary}",
          { id: draftContentId },
          { timeout: 8_000 },
        );
        const currentDraft = currentDraftRaw !== null && typeof currentDraftRaw === "object" && !Array.isArray(currentDraftRaw)
          ? currentDraftRaw as Record<string, unknown> : undefined;
        if (currentDraft?._id === draftContentId && currentDraft._type === "productContent" &&
          currentDraft._rev === draftSentinelRevision && currentDraft.summary === "Synthetic preview-only isolation sentinel.") {
          const restored = await client.transaction()
            .patch(draftContentId, (patch) => patch.ifRevisionId(draftSentinelRevision!).set({ summary: originalDraftSummary }))
            .commit({ returnDocuments: true, returnFirst: true });
          const restoredRaw: unknown = await rawClient.fetch<unknown>(
            "*[_id == $id][0]{_id,_type,summary}",
            { id: draftContentId },
            { timeout: 8_000 },
          );
          const restoredReadback = restoredRaw !== null && typeof restoredRaw === "object" && !Array.isArray(restoredRaw)
            ? restoredRaw as Record<string, unknown> : undefined;
          report.previewDraftSentinelRestored = restored?._id === draftContentId && restoredReadback?._id === draftContentId &&
            restoredReadback._type === "productContent" && restoredReadback.summary === originalDraftSummary;
        }
      } catch {
        report.previewDraftSentinelRestored = false;
      }
    }
    if (previewSecretForCleanup) {
      try {
        const currentRaw: unknown = await rawClient.fetch<unknown>(
          "*[_id == $id][0]{_id,_type,_rev,secret}",
          { id: secretDocumentId },
          { timeout: 8_000 },
        );
        const current = currentRaw !== null && typeof currentRaw === "object" && !Array.isArray(currentRaw) ? currentRaw as Record<string, unknown> : undefined;
        const observedRevision = typeof current?._rev === "string" ? current._rev : undefined;
        if (current?._id === secretDocumentId && current._type === "sanity.previewUrlSecret" && observedRevision &&
          (!secretDocumentRevision || observedRevision === secretDocumentRevision) && current.secret === previewSecretForCleanup) {
          await client.transaction()
            .patch(secretDocumentId, (patch) => patch.ifRevisionId(observedRevision).set({ secret: previewSecretForCleanup }))
            .delete(secretDocumentId)
            .commit();
          report.temporaryPreviewSecretDeleted = true;
        }
      } catch {
        report.temporaryPreviewSecretDeleted = false;
      }
    }
  }
  if (report.temporaryPreviewSecretCreated === true && report.temporaryPreviewSecretDeleted !== true) {
    report.outcome = "fail";
    report.failureCode = "smoke_preview_secret_cleanup_failed";
  }
  if (draftSentinelApplied && report.previewDraftSentinelRestored !== true) {
    report.outcome = "fail";
    report.failureCode = "smoke_draft_sentinel_restore_failed";
  }
  if (report.outcome !== "fail") report.outcome = "pass";
  report.evidenceFile = basename(args.reportPath);
  await saveSanitizedReport(args.reportPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.outcome === "fail") throw new SafeRuntimeSmokeError(String(report.failureCode));
  return report;
}

export function isDirectLocalCmsSmokeExecution(metaUrl = import.meta.url): boolean {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

if (isDirectLocalCmsSmokeExecution()) {
  runLocalCmsSmoke().catch((error: unknown) => {
    const code = error instanceof SafeRuntimeSmokeError || error instanceof SafeConfigurationError ? error.code : "smoke_failed";
    process.stderr.write(`CMS runtime smoke failed (${code}).\n`);
    process.exitCode = 1;
  });
}
