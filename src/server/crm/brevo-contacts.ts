import "server-only";

import type { CrmContacts, CrmRequest, AdapterResult } from "../../domain/ports";
import type { LeadScenario } from "../../domain/measurement";
import { isUtcDateTime } from "../../domain/utc";
import type { LiveTarget } from "../config/targets";

const endpoint = "https://api.brevo.com/v3/contacts";
const timeoutMs = 10_000;
const scenarios: readonly LeadScenario[] = [
  "marketing_site",
  "editorial_site",
  "commerce_content",
];

export interface BrevoContactsOptions {
  readonly fetcher?: typeof fetch;
  readonly now?: () => Date;
}

function isValidRequest(request: CrmRequest): boolean {
  if (!request || typeof request !== "object") return false;
  if (typeof request.email !== "string") return false;
  const email = request.email.trim();
  return email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !/[\u0000-\u001f\u007f]/.test(email) &&
    scenarios.includes(request.scenario) &&
    isUtcDateTime(request.contactPermissionAt);
}

function utcDate(date: Date): string | null {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Creates the server-only Brevo Contacts adapter. Only the configured dev/prod
 * target can be supplied; fixture selection is handled by the adapter selector.
 */
export function createBrevoContacts(
  target: LiveTarget<"crm">,
  options: BrevoContactsOptions = {},
): CrmContacts {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const isLiveTarget = target?.mode === "live" && target.component === "crm" &&
    (target.environment === "development" || target.environment === "production");
  const settings = isLiveTarget ? target.settings : undefined;
  const rawListId = settings?.BREVO_REQUEST_LIST_ID;
  const listId = Number(rawListId);
  const validSettings = typeof settings?.BREVO_API_KEY === "string" &&
    settings.BREVO_API_KEY.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(settings.BREVO_API_KEY) &&
    /^\d+$/.test(rawListId ?? "") && Number.isSafeInteger(listId) && listId > 0;

  return {
    async upsertRequest(request): Promise<AdapterResult<{ readonly accepted: true }>> {
      if (!validSettings) return { ok: false, code: "adapter_unavailable" };
      if (!isValidRequest(request)) {
        return { ok: false, code: "invalid_input" };
      }

      let requestedAt: string | null;
      try {
        requestedAt = utcDate(now());
      } catch {
        requestedAt = null;
      }
      if (!requestedAt) return { ok: false, code: "adapter_unavailable" };

      const payload = {
        email: request.email.trim().toLowerCase(),
        attributes: {
          PKG_SCENARIO: request.scenario,
          PKG_CONTACT_PERMISSION_AT: request.contactPermissionAt,
          PKG_REQUESTED_AT: requestedAt,
        },
        listIds: [listId],
        updateEnabled: true,
      };

      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            accept: "application/json",
            "api-key": settings.BREVO_API_KEY,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });

        // Brevo documents 201 for a new contact and 204 for an upsert of an
        // existing contact. Other 2xx responses are not part of this contract.
        if (response.status === 201 || response.status === 204) {
          return { ok: true, value: { accepted: true } };
        }
      } catch {
        // Provider messages may contain submitted data. Expose only the port code.
      }

      return { ok: false, code: "crm_unavailable" };
    },
  };
}
