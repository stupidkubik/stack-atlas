#!/usr/bin/env node
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { Pool } from "pg";

const requestListPattern = /pkgcompass.*requests?/i;
const requiredScope = "development";
const databaseRoles = {
  DATABASE_LEAD_URL: { role: "pkgcompass_lead_writer", pooled: true },
  DATABASE_READ_URL: { role: "pkgcompass_public_reader", pooled: true },
  DATABASE_IMPORT_URL: { role: "pkgcompass_metrics_writer", pooled: false },
  DATABASE_MIGRATION_URL: { role: "pkgcompass_migration_owner", pooled: false },
};

function emit(status, code, checks) {
  process.stdout.write(`${JSON.stringify({ environment: requiredScope, status, code, ...(checks ? { checks } : {}) })}\n`);
}

function requireSafe(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

export function validateLeadApiSmokeLaunch(args, env) {
  if (args.length !== 2 || args[0] !== "--env=development" || args[1] !== "--allow-development-writes") return "usage";
  if (env.APP_ENV && env.APP_ENV !== "development") return "environment_mismatch";
  if (env.CI === "true" || env.CI === "1" || env.GITHUB_EVENT_NAME === "pull_request" ||
    env.PKGCOMPASS_UNTRUSTED_PR === "true" || env.VERCEL_GIT_PULL_REQUEST_ID?.trim() ||
    env.VERCEL || env.VERCEL_ENV) return "untrusted_execution_context";
  return null;
}

export function isDevelopmentRuntimeAttestation(status, body) {
  return (status === 200 || status === 503) && body?.environment === "development" &&
    typeof body.available === "boolean" && body.available === (status === 200);
}

function parsedDatabaseTarget(value, expected) {
  try {
    const url = new URL(value ?? "");
    const host = url.hostname.toLowerCase();
    const pooled = host.includes("-pooler.");
    const parameterNames = [...new Set(url.searchParams.keys())];
    const safeParameters = parameterNames.every((name) => {
      const values = url.searchParams.getAll(name);
      if (values.length !== 1) return false;
      if (name === "sslmode") return ["require", "verify-full"].includes(values[0]);
      if (name === "channel_binding") return ["require", "prefer"].includes(values[0]);
      return false;
    });
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !host.endsWith(".neon.tech") ||
      !url.username || !url.password || url.username !== expected.role || pooled !== expected.pooled ||
      !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "") ||
      !/^[A-Za-z0-9_.-]+$/.test(url.pathname.slice(1)) || url.hash || !safeParameters) return undefined;
    return { host: host.replace("-pooler.", "."), database: url.pathname };
  } catch { return undefined; }
}

export function validateLeadDatabaseTarget(source) {
  const lead = parsedDatabaseTarget(source.DATABASE_LEAD_URL, databaseRoles.DATABASE_LEAD_URL);
  if (!lead) return "lead_database_target_invalid";
  for (const name of ["DATABASE_READ_URL", "DATABASE_IMPORT_URL", "DATABASE_MIGRATION_URL"]) {
    if (!source[name]) continue;
    const peer = parsedDatabaseTarget(source[name], databaseRoles[name]);
    if (!peer || peer.host !== lead.host || peer.database !== lead.database) return "database_target_mismatch";
  }
  return null;
}

function safeLoopbackOrigin(value) {
  try {
    const origin = new URL(value ?? "");
    return ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
      ["http:", "https:"].includes(origin.protocol) && !origin.username && !origin.password &&
      !origin.search && !origin.hash && origin.pathname === "/" ? origin.origin : undefined;
  } catch { return undefined; }
}

export function validateLeadSmokeTargetSelectors(processEnv, localEnv) {
  const appEnvironment = processEnv.APP_ENV?.trim();
  if (appEnvironment !== "development") return { code: "app_env_not_development" };
  if (localEnv.APP_ENV?.trim() && localEnv.APP_ENV.trim() !== appEnvironment) {
    return { code: "environment_mismatch" };
  }
  const origin = safeLoopbackOrigin(processEnv.SITE_URL?.trim());
  return origin ? { origin } : { code: "site_origin_not_loopback" };
}

function readDevelopmentConfiguration() {
  const local = parseEnv(readFileSync(".env.local", "utf8"));
  const target = validateLeadSmokeTargetSelectors(process.env, local);
  requireSafe(target.origin, target.code ?? "site_origin_not_loopback");
  for (const name of ["DATABASE_LEAD_URL", "DATABASE_READ_URL", "DATABASE_IMPORT_URL", "DATABASE_MIGRATION_URL", "LEAD_HMAC_SECRET", "BREVO_API_KEY", "BREVO_REQUEST_LIST_ID"]) {
    if (process.env[name] && process.env[name] !== local[name]) {
      requireSafe(false, "runtime_configuration_mismatch");
    }
  }
  requireSafe(local.BREVO_API_KEY?.trim(), "crm_configuration_missing");
  requireSafe(/^\d+$/.test(local.BREVO_REQUEST_LIST_ID ?? ""), "crm_configuration_missing");
  requireSafe(local.FP04_TEST_EMAIL?.trim(), "owner_alias_not_configured");
  requireSafe(local.LEAD_HMAC_SECRET?.length >= 32, "lead_security_configuration_missing");
  requireSafe(local.DATABASE_LEAD_URL?.trim(), "lead_database_configuration_missing");
  requireSafe(!validateLeadDatabaseTarget(local), validateLeadDatabaseTarget(local) ?? "lead_database_target_invalid");
  const alias = local.FP04_TEST_EMAIL.trim().toLowerCase();
  requireSafe(alias.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alias), "owner_alias_invalid");
  const listId = Number(local.BREVO_REQUEST_LIST_ID);
  requireSafe(Number.isSafeInteger(listId) && listId > 0, "crm_list_configuration_invalid");
  return { local, origin: target.origin, alias, listId };
}

function digest(secret, value) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function ownedContact(contact, { id, email, listId, createdAt }) {
  return contact?.id === id && typeof contact.email === "string" &&
    contact.email.toLowerCase() === email && contact.createdAt === createdAt &&
    Array.isArray(contact.listIds) && contact.listIds.length === 1 && contact.listIds[0] === listId;
}

function parseSafeJson(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

async function brevoRequest(apiKey, method, path, body) {
  try {
    const response = await fetch(`https://api.brevo.com/v3${path}`, {
      method,
      redirect: "error",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 204 || response.status === 404) return { status: response.status, body: null };
    return { status: response.status, body: parseSafeJson(await response.text()) };
  } catch { return { status: 0, body: null }; }
}

function isDevelopmentRequestList(result, listId) {
  const name = typeof result.body?.name === "string" ? result.body.name : "";
  return result.status === 200 && result.body?.id === listId && requestListPattern.test(name) &&
    /\bdev(?:elopment)?\b/i.test(name) && !/\bprod(?:uction)?\b/i.test(name);
}

function assertApiResult(result, expectedStatus = 200) {
  requireSafe(result.status === expectedStatus && result.json && typeof result.json === "object", "lead_api_http_status");
  return result.json;
}

async function requestLead(origin, input) {
  try {
    const response = await fetch(new URL("/api/leads/", origin), {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin,
        "x-real-ip": input.syntheticIp,
      },
      body: JSON.stringify({
        requestId: input.requestId,
        email: input.email,
        scenario: input.scenario,
        contactPermission: true,
        website: "",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = parseSafeJson(await response.text());
    return { status: response.status, json };
  } catch { return { status: 0, json: null }; }
}

function makeSyntheticIp() {
  // TEST-NET-1 is reserved for examples and cannot identify a real visitor.
  return `192.0.2.${randomInt(1, 255)}`;
}

async function newUnusedSyntheticIp(pool, secret) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const ip = makeSyntheticIp();
    const ipHmac = digest(secret, ip);
    const result = await pool.query("SELECT 1 FROM public.rate_limits WHERE ip_hmac = $1 LIMIT 1", [ipHmac]);
    if (result.rowCount === 0) return { ipHmac, ip };
  }
  throw new Error("synthetic_rate_limit_preflight_failed");
}

async function checkHttpServer(origin) {
  try {
    const response = await fetch(new URL("/api/leads/", origin), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    requireSafe(response.status === 405, "loopback_api_not_ready");
  } catch (error) {
    if (error?.code) throw error;
    throw new Error("loopback_api_not_ready");
  }
}

async function checkDevelopmentRuntime(origin) {
  try {
    const response = await fetch(new URL("/api/catalog-status/", origin), {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    const body = parseSafeJson(await response.text());
    requireSafe(isDevelopmentRuntimeAttestation(response.status, body), "development_runtime_not_attested");
  } catch (error) {
    if (error?.code) throw error;
    throw new Error("development_runtime_not_attested");
  }
}

async function main() {
  const launchError = validateLeadApiSmokeLaunch(process.argv.slice(2), process.env);
  requireSafe(!launchError, launchError ?? "usage");
  const { local, origin, alias, listId } = readDevelopmentConfiguration();
  await checkDevelopmentRuntime(origin);
  await checkHttpServer(origin);

  const pool = new Pool({
    connectionString: local.DATABASE_LEAD_URL,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 5_000,
    application_name: "pkgcompass-lm-dev-api-smoke",
  });
  let crmContact;
  let requestId;
  let duplicateRequestId;
  let dedupKey;
  let payloadHash;
  let syntheticIpHmac;
  let testStart;
  let expectedAcceptedConversionId;
  let operationError;
  let cleanupError;
  let checks;
  let contactCreationUncertain = false;

  try {
    const databasePreflight = await pool.query("SELECT to_regclass('public.lead_requests') AS leads, to_regclass('public.rate_limits') AS limits");
    requireSafe(databasePreflight.rows[0]?.leads === "lead_requests" && databasePreflight.rows[0]?.limits === "rate_limits", "lead_schema_unavailable");
    await pool.query("SELECT 1");
  } catch {
    await pool.end().catch(() => undefined);
    throw new Error("lead_database_preflight_failed");
  }

  try {
    const list = await brevoRequest(local.BREVO_API_KEY, "GET", `/contacts/lists/${listId}`);
    requireSafe(isDevelopmentRequestList(list, listId), "brevo_list_not_confirmed_development");
    const existing = await brevoRequest(local.BREVO_API_KEY, "GET", `/contacts/${encodeURIComponent(alias)}`);
    requireSafe(existing.status === 404, "owner_alias_already_exists_no_mutation");

    const scenario = "marketing_site";
    const leadDigest = (submittedEmail) => ({
      dedupKey: digest(local.LEAD_HMAC_SECRET, JSON.stringify([submittedEmail, scenario])),
      payloadHash: digest(local.LEAD_HMAC_SECRET, JSON.stringify([submittedEmail, scenario, "contact_v1"])),
    });
    ({ dedupKey, payloadHash } = leadDigest(alias));
    const dedupPreflight = await pool.query(
      "SELECT 1 FROM public.lead_requests WHERE dedup_key = $1 AND state = 'accepted' LIMIT 1",
      [dedupKey],
    );
    requireSafe(dedupPreflight.rowCount === 0, "owner_alias_already_has_accepted_lead_no_mutation");
    const syntheticAddress = await newUnusedSyntheticIp(pool, local.LEAD_HMAC_SECRET);
    syntheticIpHmac = syntheticAddress.ipHmac;
    testStart = new Date().toISOString();
    requestId = randomUUID();
    duplicateRequestId = randomUUID();

    const contactCreate = await brevoRequest(local.BREVO_API_KEY, "POST", "/contacts", {
      email: alias,
      listIds: [listId],
      updateEnabled: false,
    });
    if (contactCreate.status !== 201) {
      contactCreationUncertain = contactCreate.status === 0;
      requireSafe(false, "owner_alias_create_only_failed");
    }
    const contactId = contactCreate.body?.id;
    if (!Number.isSafeInteger(contactId) || contactId < 1) {
      contactCreationUncertain = true;
      requireSafe(false, "contact_creation_identity_unconfirmed");
    }
    const createdContact = await brevoRequest(local.BREVO_API_KEY, "GET", `/contacts/${contactId}`);
    crmContact = {
      id: contactId,
      email: alias,
      listId,
      createdAt: createdContact.body?.createdAt,
    };
    requireSafe(createdContact.status === 200 && typeof crmContact.createdAt === "string" &&
      ownedContact(createdContact.body, crmContact), "contact_cleanup_identity_unconfirmed");

    const payload = { email: alias, scenario, syntheticIp: syntheticAddress.ip };
    const first = assertApiResult(await requestLead(origin, { ...payload, requestId }));
    requireSafe(first.status === "accepted" && first.analyticsEligible === true &&
      typeof first.conversionId === "string", "lead_api_first_submit_failed");
    const firstConversionId = first.conversionId;
    expectedAcceptedConversionId = firstConversionId;
    const firstRetry = assertApiResult(await requestLead(origin, { ...payload, requestId }));
    requireSafe(firstRetry.status === "accepted" && firstRetry.analyticsEligible === true &&
      firstRetry.conversionId === firstConversionId, "lead_api_same_request_retry_mismatch");
    const duplicate = assertApiResult(await requestLead(origin, { ...payload, requestId: duplicateRequestId }));
    requireSafe(duplicate.status === "accepted" && duplicate.analyticsEligible === false &&
      !("conversionId" in duplicate), "lead_api_duplicate_contract_mismatch");

    const saved = await pool.query(
      `SELECT state, dedup_key, payload_hash, scenario, contact_permission_version, conversion_id::text
       FROM public.lead_requests WHERE request_id = $1::uuid`,
      [requestId],
    );
    requireSafe(saved.rowCount === 1 && saved.rows[0].state === "accepted" &&
      saved.rows[0].dedup_key === dedupKey && saved.rows[0].payload_hash === payloadHash &&
      saved.rows[0].scenario === scenario && saved.rows[0].contact_permission_version === "contact_v1" &&
      saved.rows[0].conversion_id === firstConversionId, "lead_hash_only_row_verification_failed");
    const duplicateRow = await pool.query("SELECT 1 FROM public.lead_requests WHERE request_id = $1::uuid", [duplicateRequestId]);
    requireSafe(duplicateRow.rowCount === 0, "lead_duplicate_created_extra_row");
    checks = { apiAccepted: true, sameRequestRetryStable: true, distinctRequestDeduplicated: true, hashOnlyRowVerified: true };
  } catch (error) {
    operationError = error?.code ?? "lead_api_smoke_failed";
  } finally {
    if (syntheticIpHmac && testStart) {
      try {
        const cleanupAt = new Date().toISOString();
        await pool.query(
          "DELETE FROM public.rate_limits WHERE ip_hmac = $1 AND occurred_at >= $2::timestamptz AND occurred_at <= $3::timestamptz",
          [syntheticIpHmac, testStart, cleanupAt],
        );
        const remaining = await pool.query("SELECT 1 FROM public.rate_limits WHERE ip_hmac = $1 LIMIT 1", [syntheticIpHmac]);
        if (remaining.rowCount) cleanupError ??= "rate_limit_cleanup_identity_unconfirmed";
      } catch { cleanupError ??= "rate_limit_cleanup_failed"; }
    }
    for (const id of [duplicateRequestId, requestId]) {
      if (!id || !dedupKey || !payloadHash) continue;
      try {
        const candidate = await pool.query(
          `SELECT state, dedup_key, payload_hash, scenario, contact_permission_version, conversion_id::text
           FROM public.lead_requests WHERE request_id = $1::uuid`,
          [id],
        );
        if (candidate.rowCount === 0) continue;
        const row = candidate.rows[0];
        if (candidate.rowCount !== 1 || row.dedup_key !== dedupKey || row.payload_hash !== payloadHash ||
          row.scenario !== "marketing_site" || row.contact_permission_version !== "contact_v1") {
          cleanupError ??= "lead_row_cleanup_identity_unconfirmed";
          continue;
        }
        if (row.state === "accepted") {
          if (!expectedAcceptedConversionId || row.conversion_id !== expectedAcceptedConversionId) {
            cleanupError ??= "accepted_lead_cleanup_identity_unconfirmed";
            continue;
          }
        } else if (!(row.state === "pending" || row.state === "failed")) {
          cleanupError ??= "lead_row_cleanup_state_unconfirmed";
          continue;
        }
        await pool.query(
          `DELETE FROM public.lead_requests
           WHERE request_id = $1::uuid AND dedup_key = $2 AND payload_hash = $3
             AND scenario = 'marketing_site' AND contact_permission_version = 'contact_v1'
             AND state = $5 AND conversion_id IS NOT DISTINCT FROM $4::uuid`,
          [id, dedupKey, payloadHash, row.conversion_id, row.state],
        );
        const remaining = await pool.query("SELECT 1 FROM public.lead_requests WHERE request_id = $1::uuid", [id]);
        if (remaining.rowCount) cleanupError ??= "lead_row_cleanup_identity_unconfirmed";
      } catch { cleanupError ??= "lead_row_cleanup_failed"; }
    }
    if (crmContact) {
      try {
        const candidate = await brevoRequest(local.BREVO_API_KEY, "GET", `/contacts/${crmContact.id}`);
        if (candidate.status === 404) {
          // A missing contact is already clean.
        } else if (candidate.status !== 200 || !ownedContact(candidate.body, crmContact)) {
          cleanupError ??= "contact_cleanup_identity_unconfirmed";
        } else {
          const deleted = await brevoRequest(local.BREVO_API_KEY, "DELETE", `/contacts/${crmContact.id}`);
          const afterDelete = deleted.status === 204
            ? await brevoRequest(local.BREVO_API_KEY, "GET", `/contacts/${crmContact.id}`)
            : null;
          if (deleted.status !== 204 || afterDelete?.status !== 404) cleanupError ??= "contact_cleanup_failed";
        }
      } catch { cleanupError ??= "contact_cleanup_failed"; }
    }
    await pool.end().catch(() => { cleanupError ??= "lead_database_close_failed"; });
    if (contactCreationUncertain) cleanupError ??= "contact_creation_outcome_uncertain";
  }

  if (cleanupError) {
    emit("fail", cleanupError);
    process.exitCode = 1;
    return;
  }
  if (operationError) {
    emit("fail", operationError);
    process.exitCode = 1;
    return;
  }
  emit("pass", "lead_api_retry_duplicate_cleanup", { ...checks, ownedRowsAndContactRemoved: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = error && typeof error.code === "string" && /^[a-z][a-z0-9_]{0,80}$/.test(error.code)
      ? error.code
      : "lead_api_smoke_failed_safe";
    emit("fail", code);
    process.exitCode = 1;
  });
}
