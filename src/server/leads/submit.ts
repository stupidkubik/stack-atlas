import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import type { CrmContacts } from "../../domain/ports";
import {
  CONTACT_PERMISSION_VERSION,
  createContactPermission,
  type LeadResult,
  type LeadSubmission,
} from "../../domain/leads";
import { conversionId, isEventId } from "../../domain/ids";
import { utcDateTime } from "../../domain/utc";
import type { LeadRepository } from "../../domain/lead-ports";

export interface LeadSubmitDependencies {
  readonly repository: LeadRepository;
  readonly crm: CrmContacts;
  readonly hmacSecret: string;
  readonly now?: () => Date;
  readonly rateLimitAlreadyChecked?: boolean;
}

function digest(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function timestamp(now: Date): string | undefined {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return undefined;
  try {
    return utcDateTime(now.toISOString());
  } catch {
    return undefined;
  }
}

/** Executes CRM only after rate limit, request identity, and deduplication are recorded. */
export async function submitLead(
  submission: LeadSubmission,
  ipHmac: string,
  dependencies: LeadSubmitDependencies,
): Promise<LeadResult> {
  const now = (dependencies.now ?? (() => new Date()))();
  const nowIso = timestamp(now);
  if (
    !nowIso || !isEventId(submission.requestId) ||
    !/^[0-9a-f]{64}$/.test(ipHmac) || dependencies.hmacSecret.trim().length < 32
  ) return { status: "unavailable" };

  if (!dependencies.rateLimitAlreadyChecked) {
    let allowed: boolean;
    try {
      allowed = await dependencies.repository.consumeRateLimit(ipHmac, nowIso);
    } catch {
      return { status: "unavailable" };
    }
    if (!allowed) return { status: "rate_limited" };
  }

  const dedupKey = digest(
    dependencies.hmacSecret,
    JSON.stringify([submission.email, submission.scenario]),
  );
  const payloadHash = digest(
    dependencies.hmacSecret,
    JSON.stringify([submission.email, submission.scenario, CONTACT_PERMISSION_VERSION]),
  );
  const conversionIdCandidate = randomUUID();
  let reservation;
  try {
    reservation = await dependencies.repository.reserve({
      requestId: submission.requestId,
      dedupKey,
      payloadHash,
      scenario: submission.scenario,
      contactPermissionVersion: submission.contactPermission.version,
      contactPermissionAt: submission.contactPermission.acceptedAt,
      conversionId: conversionIdCandidate,
      now: nowIso,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch {
    return { status: "unavailable" };
  }

  if (reservation.kind === "conflict") return { status: "conflict" };
  if (reservation.kind === "duplicate") return { status: "accepted", analyticsEligible: false };
  if (reservation.kind === "accepted") {
    if (!isEventId(reservation.conversionId)) return { status: "unavailable" };
    return {
      status: "accepted",
      conversionId: conversionId(reservation.conversionId),
      analyticsEligible: true,
    };
  }

  const contactPermission = createContactPermission(submission.contactPermission.acceptedAt);
  const crmResult = await dependencies.crm.upsertRequest({
    email: submission.email,
    scenario: submission.scenario,
    contactPermissionAt: contactPermission.acceptedAt,
  }).catch(() => ({ ok: false as const, code: "crm_unavailable" as const }));
  if (!crmResult.ok || !crmResult.value.accepted) {
    await dependencies.repository.markFailed(submission.requestId, nowIso).catch(() => undefined);
    return { status: "unavailable" };
  }

  let finalState: "accepted" | "duplicate";
  try {
    finalState = await dependencies.repository.markAccepted(submission.requestId, nowIso);
  } catch {
    // The CRM upsert is idempotent; the client can retry this same requestId.
    return { status: "unavailable" };
  }
  if (finalState === "duplicate") return { status: "accepted", analyticsEligible: false };
  if (!isEventId(reservation.conversionId)) return { status: "unavailable" };
  return {
    status: "accepted",
    conversionId: conversionId(reservation.conversionId),
    analyticsEligible: true,
  };
}

export function hashLeadIp(secret: string, rawIp: string): string {
  return digest(secret, rawIp);
}
