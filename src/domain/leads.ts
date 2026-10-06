import { conversionId, isConversionId, isEventId, type ConversionId, type EventId } from "./ids";
import { plainDataRecord } from "./safe-objects";
import { isUtcDateTime, type UtcDateTime } from "./utc";

export const LEAD_SCENARIOS = [
  "marketing_site",
  "editorial_site",
  "commerce_content",
] as const;

export type LeadScenario = typeof LEAD_SCENARIOS[number];
export type ConsentState = "unknown" | "denied" | "granted";
export const CONTACT_PERMISSION_VERSION = "contact_v1" as const;

export interface ContactPermission {
  readonly accepted: true;
  readonly version: typeof CONTACT_PERMISSION_VERSION;
  readonly acceptedAt: UtcDateTime;
}

/** The address exists only in this transient server request and Brevo. */
export interface LeadSubmission {
  readonly requestId: string;
  readonly email: string;
  readonly scenario: LeadScenario;
  readonly contactPermission: ContactPermission;
}

export type LeadResult =
  | {
      readonly status: "accepted";
      readonly conversionId: ConversionId;
      readonly analyticsEligible: true;
    }
  | {
      readonly status: "accepted";
      readonly analyticsEligible: false;
    }
  | {
      readonly status: "invalid" | "conflict" | "rate_limited" | "unavailable";
    };

export type EventEnvelope = {
  readonly eventId: EventId;
  readonly eventSchemaVersion: 1;
  readonly environment: "development" | "production";
  readonly routeType: "home" | "catalog" | "product" | "comparison" | "methodology" | "lead_form" | "privacy";
  readonly locale: "en";
  readonly occurredAt: UtcDateTime;
};

export interface ConsentCookieValue {
  readonly state: "denied" | "granted";
  readonly policyVersion: 1;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

export function isLeadScenario(value: unknown): value is LeadScenario {
  return typeof value === "string" && LEAD_SCENARIOS.includes(value as LeadScenario);
}

export function normalizeLeadEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3 || normalized.length > 254 || controlCharacters.test(normalized) ||
    !emailPattern.test(normalized)
  ) return undefined;
  return normalized;
}

export function parseConsentCookieValue(value: unknown): ConsentCookieValue | undefined {
  const record = plainDataRecord(value);
  if (!record || Object.keys(record).length !== 2 || record.policyVersion !== 1) return undefined;
  if (record.state !== "granted" && record.state !== "denied") return undefined;
  return { state: record.state, policyVersion: 1 };
}

export function parseLeadResult(value: unknown): LeadResult | undefined {
  const record = plainDataRecord(value);
  if (!record || typeof record.status !== "string") return undefined;

  if (record.status === "accepted") {
    if (record.analyticsEligible === false && Object.keys(record).length === 2) {
      return { status: "accepted", analyticsEligible: false };
    }
    if (
      record.analyticsEligible === true && Object.keys(record).length === 3 &&
      isConversionId(record.conversionId)
    ) {
      return {
        status: "accepted",
        conversionId: conversionId(record.conversionId),
        analyticsEligible: true,
      };
    }
    return undefined;
  }

  if (
    (record.status === "invalid" || record.status === "conflict" ||
      record.status === "rate_limited" || record.status === "unavailable") &&
    Object.keys(record).length === 1
  ) return { status: record.status };

  return undefined;
}

export function isLeadEventId(value: unknown): value is EventId {
  return isEventId(value);
}

export function createContactPermission(acceptedAt: string): ContactPermission {
  if (!isUtcDateTime(acceptedAt)) throw new Error("Invalid contact permission timestamp.");
  return { accepted: true, version: CONTACT_PERMISSION_VERSION, acceptedAt };
}
