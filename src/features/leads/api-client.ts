import { parseLeadResult, type LeadResult, type LeadScenario } from "../../domain/leads";

export type LeadSubmissionOutcome =
  | { readonly kind: "result"; readonly result: LeadResult }
  | { readonly kind: "retryable_error" };

export interface LeadFormPayload {
  readonly requestId: string;
  readonly email: string;
  readonly scenario: LeadScenario;
}

/** Sends the transient form values directly to the same-origin server endpoint. */
export async function submitLeadForm(payload: LeadFormPayload): Promise<LeadSubmissionOutcome> {
  try {
    const response = await fetch("/api/leads/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        ...payload,
        contactPermission: true,
        website: "",
      }),
    });
    const body: unknown = await response.json();
    const result = parseLeadResult(body);
    if (!result) return { kind: "retryable_error" };
    if (response.status === 200 && result.status === "accepted") return { kind: "result", result };
    if (
      (response.status === 400 && result.status === "invalid") ||
      (response.status === 409 && result.status === "conflict") ||
      (response.status === 429 && result.status === "rate_limited") ||
      (response.status === 503 && result.status === "unavailable")
    ) return { kind: "result", result };
    return { kind: "retryable_error" };
  } catch {
    return { kind: "retryable_error" };
  }
}
