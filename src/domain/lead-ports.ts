import type { LeadScenario } from "./leads";

export interface LeadReservationInput {
  readonly requestId: string;
  readonly dedupKey: string;
  readonly payloadHash: string;
  readonly scenario: LeadScenario;
  readonly contactPermissionVersion: string;
  readonly contactPermissionAt: string;
  readonly conversionId: string;
  readonly now: string;
  readonly expiresAt: string;
}

export type LeadReservation =
  | { readonly kind: "continue"; readonly conversionId: string }
  | { readonly kind: "accepted"; readonly conversionId: string }
  | { readonly kind: "duplicate" }
  | { readonly kind: "conflict" };

export interface LeadRepository {
  consumeRateLimit(ipHmac: string, now: string): Promise<boolean>;
  reserve(input: LeadReservationInput): Promise<LeadReservation>;
  markAccepted(requestId: string, now: string): Promise<"accepted" | "duplicate">;
  markFailed(requestId: string, now: string): Promise<void>;
}
