import { describe, expect, it, vi } from "vitest";
import type { CrmRequest } from "../src/domain/ports";
import type { LiveTarget } from "../src/server/config/targets";
import { createBrevoContacts } from "../src/server/crm/brevo-contacts";
import { createCrmContacts } from "../src/server/crm";
import { isOwnedContactForCleanup } from "./fp04-brevo-live-helpers";

const target: LiveTarget<"crm"> = {
  mode: "live",
  environment: "development",
  component: "crm",
  settings: {
    BREVO_API_KEY: "unit-test-key",
    BREVO_REQUEST_LIST_ID: "73",
  },
};

const request: CrmRequest = {
  email: "  Owner.Alias@example.test ",
  scenario: "editorial_site",
  contactPermissionAt: "2026-10-05T20:00:00.000Z" as CrmRequest["contactPermissionAt"],
};

const fixedNow = () => new Date("2026-10-05T23:30:00.000Z");

describe("Brevo Contacts adapter", () => {
  it.each([201, 204])("accepts documented upsert status %i", async (status) => {
    const calls: Array<{ readonly url: string; readonly init?: RequestInit }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status });
    });
    const crm = createBrevoContacts(target, { fetcher, now: fixedNow });

    await expect(crm.upsertRequest(request)).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [{ url, init }] = calls;
    expect(url).toBe("https://api.brevo.com/v3/contacts");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({
      accept: "application/json",
      "api-key": "unit-test-key",
      "content-type": "application/json",
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      email: "owner.alias@example.test",
      attributes: {
        PKG_SCENARIO: "editorial_site",
        PKG_CONTACT_PERMISSION_AT: "2026-10-05T20:00:00.000Z",
        PKG_REQUESTED_AT: "2026-10-05",
      },
      listIds: [73],
      updateEnabled: true,
    });
    expect(body).not.toHaveProperty("emailBlacklisted");
    expect(body).not.toHaveProperty("smsBlacklisted");
  });

  it.each([400, 401, 403, 404, 429, 500, 503, 202])(
    "does not accept undocumented or failed status %i",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        new Response("private provider payload", { status }),
      );
      const crm = createBrevoContacts(target, { fetcher, now: fixedNow });

      await expect(crm.upsertRequest(request)).resolves.toEqual({
        ok: false,
        code: "crm_unavailable",
      });
    },
  );

  it("maps a transport timeout to a safe port failure", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new DOMException("private provider details", "AbortError");
    });
    const crm = createBrevoContacts(target, { fetcher, now: fixedNow });

    await expect(crm.upsertRequest(request)).resolves.toEqual({
      ok: false,
      code: "crm_unavailable",
    });
  });

  it("rejects invalid input without calling Brevo", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const crm = createBrevoContacts(target, { fetcher, now: fixedNow });

    await expect(crm.upsertRequest({
      ...request,
      scenario: "other" as CrmRequest["scenario"],
    })).resolves.toEqual({ ok: false, code: "invalid_input" });
    await expect(crm.upsertRequest({
      ...request,
      contactPermissionAt: "not-a-timestamp" as CrmRequest["contactPermissionAt"],
    })).resolves.toEqual({ ok: false, code: "invalid_input" });
    await expect(crm.upsertRequest({
      ...request,
      email: "not-an-email",
    })).resolves.toEqual({ ok: false, code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("selects the fixture CRM offline and never calls fetch", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const crm = createCrmContacts({ APP_ENV: "fixture" }, { fetcher, now: fixedNow });

    await expect(crm.upsertRequest(request)).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses Brevo only for an explicitly selected development target", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const crm = createCrmContacts({
      APP_ENV: "development",
      BREVO_API_KEY: "unit-test-key",
      BREVO_REQUEST_LIST_ID: "73",
    }, { fetcher, now: fixedNow });

    await expect(crm.upsertRequest(request)).resolves.toEqual({
      ok: true,
      value: { accepted: true },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("permits cleanup only for the create-returned ID, owner alias, and dev list", () => {
    const contact = {
      id: 901,
      email: "owner.alias@example.test",
      listIds: [73],
    };
    expect(isOwnedContactForCleanup(contact, 901, "owner.alias@example.test", 73)).toBe(true);
    expect(isOwnedContactForCleanup({ ...contact, listIds: [73, 74] }, 901,
      "owner.alias@example.test", 73)).toBe(false);
    expect(isOwnedContactForCleanup(contact, 902, "owner.alias@example.test", 73)).toBe(false);
    expect(isOwnedContactForCleanup(contact, 901, "other@example.test", 73)).toBe(false);
    expect(isOwnedContactForCleanup(contact, 901, "owner.alias@example.test", 74)).toBe(false);
    expect(isOwnedContactForCleanup({ ...contact, createdAt: "changed" }, 901,
      "owner.alias@example.test", 73, "expected")).toBe(false);
  });
});
