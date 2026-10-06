import { expect, it } from "vitest";
import { utcDateTime } from "../src/domain/utc";
import { createCrmContacts } from "../src/server/crm";
import {
  brevoRequest,
  isOwnedContactForCleanup,
  requireSafe,
  selectDevelopmentCrmTarget,
} from "./fp04-brevo-live-helpers";

const enabled = process.env.PKGCOMPASS_BREVO_LIVE_SMOKE === "tests/fp04-brevo-contact-live.test.ts";

function isCreatedAliasContact(
  contact: Record<string, unknown> | null,
  id: number,
  email: string,
  createdAt: string,
): boolean {
  return contact?.id === id && typeof contact.email === "string" &&
    contact.email.toLowerCase() === email.toLowerCase() &&
    contact.createdAt === createdAt;
}

function sameOptOutState(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const unsubscribed = (contact: Record<string, unknown>): string[] =>
    Array.isArray(contact.listUnsubscribed)
      ? contact.listUnsubscribed.map((id) => String(id)).sort()
      : [];
  const leftUnsubscribed = unsubscribed(left);
  const rightUnsubscribed = unsubscribed(right);
  return left.emailBlacklisted === right.emailBlacklisted &&
    left.smsBlacklisted === right.smsBlacklisted &&
    left.whatsappBlacklisted === right.whatsappBlacklisted &&
    leftUnsubscribed.length === rightUnsubscribed.length &&
    leftUnsubscribed.every((value, index) => value === rightUnsubscribed[index]);
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z][a-z0-9_]{0,80}$/.test(message) ? message : "contact_smoke_failed";
}

it.skipIf(!enabled)("creates, upserts, repeats, and removes only the newly created owner alias", async (context) => {
  const source = process.env;
  const target = selectDevelopmentCrmTarget(source);
  const testEmail = process.env.FP04_TEST_EMAIL;
  requireSafe(typeof testEmail === "string" && testEmail.length > 3 && testEmail.length <= 254,
    "owner_alias_not_configured");
  const listId = Number(target.settings.BREVO_REQUEST_LIST_ID);

  // Verify the configured list is explicitly development before any contact read/write.
  const listResult = await brevoRequest(target, "GET", `/contacts/lists/${listId}`);
  expect(listResult.status, "brevo_list_http_status").toBe(200);
  const listName = typeof listResult.body?.name === "string" ? listResult.body.name : "";
  const developmentList = listResult.body?.id === listId &&
    /pkgcompass.*requests?/i.test(listName) &&
    /\bdev(?:elopment)?\b/i.test(listName) &&
    !/\bprod(?:uction)?\b/i.test(listName);
  expect(developmentList, "brevo_development_request_list_mismatch").toBe(true);

  const preflight = await brevoRequest(target, "GET", `/contacts/${encodeURIComponent(testEmail)}`);
  if (preflight.status === 200) {
    context.skip("owner_alias_already_exists_no_mutation");
    return;
  }
  expect(preflight.status, "owner_alias_preflight_must_be_absent").toBe(404);

  // Create-only prevents a race from updating an alias that appeared after preflight.
  const created = await brevoRequest(target, "POST", "/contacts", {
    email: testEmail,
    listIds: [listId],
    updateEnabled: false,
  });
  expect(created.status, "owner_alias_create_only_failed").toBe(201);
  let candidateId = created.body?.id;
  if (typeof candidateId !== "number" || !Number.isSafeInteger(candidateId) || candidateId < 1) {
    // A documented 201 proves this create-only request created the contact; recover its ID by
    // exact alias so cleanup can still target only that new contact if the response was malformed.
    const recovered = await brevoRequest(target, "GET", `/contacts/${encodeURIComponent(testEmail)}`);
    const recoveredId = recovered.body?.id;
    const recoveredContact = recovered.body;
    if (recovered.status !== 200 || typeof recoveredId !== "number" ||
      !Number.isSafeInteger(recoveredId) || recoveredId < 1 ||
      typeof recoveredContact?.email !== "string" ||
      recoveredContact.email.toLowerCase() !== testEmail.toLowerCase() ||
      !Array.isArray(recoveredContact.listIds) || recoveredContact.listIds.length !== 1 ||
      recoveredContact.listIds[0] !== listId) {
      throw new Error("owner_alias_create_id_unrecoverable_cleanup_blocked");
    }
    candidateId = recoveredId;
  }
  if (typeof candidateId !== "number" || !Number.isSafeInteger(candidateId) || candidateId < 1) {
    throw new Error("owner_alias_create_id_missing_cleanup_blocked");
  }
  const id = candidateId;
  let createdAt: string | undefined;
  let operationFailure: string | undefined;
  let cleanupFailure: string | undefined;

  try {
    const beforeResult = await brevoRequest(target, "GET", `/contacts/${id}`);
    const before = beforeResult.body;
    createdAt = typeof before?.createdAt === "string" ? before.createdAt : undefined;
    if (beforeResult.status !== 200 || !before || !createdAt ||
      !isCreatedAliasContact(before, id, testEmail, createdAt)) {
      throw new Error("owner_alias_created_identity_unconfirmed");
    }
    if (!Array.isArray(before.listIds) || before.listIds.length !== 1 || before.listIds[0] !== listId) {
      throw new Error("owner_alias_initial_list_membership_missing");
    }

    const crm = createCrmContacts(source);
    const request = {
      email: testEmail,
      scenario: "marketing_site" as const,
      contactPermissionAt: utcDateTime(new Date().toISOString()),
    };
    const firstUpsert = await crm.upsertRequest(request);
    if (!firstUpsert.ok || !firstUpsert.value.accepted) throw new Error("crm_adapter_live_upsert_failed");
    const repeatedUpsert = await crm.upsertRequest(request);
    if (!repeatedUpsert.ok || !repeatedUpsert.value.accepted) throw new Error("crm_adapter_live_repeat_failed");

    const afterResult = await brevoRequest(target, "GET", `/contacts/${id}`);
    const after = afterResult.body;
    if (afterResult.status !== 200 || !after || !isCreatedAliasContact(after, id, testEmail, createdAt)) {
      throw new Error("owner_alias_after_upsert_identity_unconfirmed");
    }
    if (!Array.isArray(after.listIds) || after.listIds.length !== 1 || after.listIds[0] !== listId) {
      throw new Error("owner_alias_final_list_membership_missing");
    }
    const attributes = after.attributes;
    const correctAttributes = attributes && typeof attributes === "object" &&
      !Array.isArray(attributes) &&
      "PKG_SCENARIO" in attributes && attributes.PKG_SCENARIO === request.scenario &&
      "PKG_CONTACT_PERMISSION_AT" in attributes && attributes.PKG_CONTACT_PERMISSION_AT === request.contactPermissionAt &&
      "PKG_REQUESTED_AT" in attributes &&
      attributes.PKG_REQUESTED_AT === request.contactPermissionAt.slice(0, 10);
    if (!correctAttributes) throw new Error("brevo_request_attributes_mismatch");
    if (!sameOptOutState(before, after)) throw new Error("brevo_optout_or_blocklist_changed");
  } catch (error) {
    operationFailure = safeErrorCode(error);
  }

  // Cleanup errors never suppress the operation result; every thrown message is a safe code.
  try {
    const cleanupCandidate = await brevoRequest(target, "GET", `/contacts/${id}`);
    if (cleanupCandidate.status === 404) {
      // Already absent; cleanup is complete.
    } else if (cleanupCandidate.status !== 200 ||
      !isOwnedContactForCleanup(cleanupCandidate.body, id, testEmail, listId, createdAt)) {
      cleanupFailure = "contact_cleanup_identity_unconfirmed";
    } else {
      const deleted = await brevoRequest(target, "DELETE", `/contacts/${id}`);
      if (deleted.status !== 204) {
        cleanupFailure = "contact_cleanup_delete_failed";
      } else {
        const afterDelete = await brevoRequest(target, "GET", `/contacts/${id}`);
        if (afterDelete.status !== 404) cleanupFailure = "contact_cleanup_absence_unconfirmed";
      }
    }
  } catch {
    cleanupFailure = "contact_cleanup_unavailable";
  }

  expect(cleanupFailure, "contact_cleanup_failed").toBeUndefined();
  expect(operationFailure, "contact_adapter_smoke_failed").toBeUndefined();
}, 120_000);
