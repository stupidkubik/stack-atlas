import { selectComponentTarget } from "../src/server/config/targets";
import type { EnvironmentSource } from "../src/server/config/environment";
import type { LiveTarget } from "../src/server/config/targets";

export interface SafeBrevoResponse {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

export function requireSafe(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

export function isOwnedContactForCleanup(
  contact: Record<string, unknown> | null,
  id: number,
  email: string,
  listId: number,
  createdAt?: string,
): boolean {
  return contact?.id === id && typeof contact.email === "string" &&
    contact.email.toLowerCase() === email.toLowerCase() &&
    Array.isArray(contact.listIds) && contact.listIds.length === 1 && contact.listIds[0] === listId &&
    (createdAt === undefined || contact.createdAt === createdAt);
}

export function selectDevelopmentCrmTarget(source: EnvironmentSource): LiveTarget<"crm"> {
  requireSafe(source.APP_ENV === "development", "app_env_not_development");
  requireSafe(source.CI !== "true" && source.CI !== "1", "ci_context_rejected");
  requireSafe(source.GITHUB_EVENT_NAME !== "pull_request", "pull_request_context_rejected");
  requireSafe(source.PKGCOMPASS_UNTRUSTED_PR !== "true", "untrusted_pr_context_rejected");
  requireSafe(!source.VERCEL && !source.VERCEL_ENV && !source.VERCEL_GIT_PULL_REQUEST_ID,
    "deployment_context_rejected");

  try {
    const target = selectComponentTarget("crm", source);
    requireSafe(target.mode === "live" && target.environment === "development",
      "crm_target_not_development");
    return target;
  } catch {
    throw new Error("crm_target_unavailable");
  }
}

export async function brevoRequest(
  target: LiveTarget<"crm">,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<SafeBrevoResponse> {
  try {
    const response = await fetch(`https://api.brevo.com/v3${path}`, {
      method,
      redirect: "error",
      headers: {
        accept: "application/json",
        "api-key": target.settings.BREVO_API_KEY,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 204 || response.status === 404) {
      return { status: response.status, body: null };
    }
    try {
      const parsed: unknown = await response.json();
      return {
        status: response.status,
        body: parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null,
      };
    } catch {
      return { status: response.status, body: null };
    }
  } catch {
    return { status: 0, body: null };
  }
}
