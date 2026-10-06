import { describe, expect, it, vi } from "vitest";
import { utcDateTime } from "../src/domain/utc";
import { MemoryLeadRepository } from "../src/server/leads/memory-lead-repository";
import { submitLead } from "../src/server/leads/submit";
import type { CrmContacts } from "../src/domain/ports";
import type { LeadSubmission } from "../src/domain/leads";

const fixedNow = () => new Date("2026-10-06T08:00:00.000Z");
const secret = "synthetic-lead-hmac-secret-for-tests-only";
const ipHmac = "a".repeat(64);

function submission(requestId: string, email = "owner.alias@example.test"): LeadSubmission {
  return {
    requestId,
    email,
    scenario: "marketing_site",
    contactPermission: {
      accepted: true,
      version: "contact_v1",
      acceptedAt: utcDateTime("2026-10-06T08:00:00.000Z"),
    },
  };
}

function crmWith(result: "accepted" | "failure" = "accepted") {
  const upsertRequest = vi.fn<CrmContacts["upsertRequest"]>(async () => result === "accepted"
    ? { ok: true, value: { accepted: true } }
    : { ok: false, code: "crm_unavailable" });
  return { upsertRequest } satisfies CrmContacts;
}

describe("lead submission service", () => {
  it("returns a stable conversion for same-request retries and neutralizes accepted duplicates", async () => {
    const repository = new MemoryLeadRepository();
    const crm = crmWith();
    const first = await submitLead(submission("00000000-0000-4000-8000-000000000001"), ipHmac, {
      repository, crm, hmacSecret: secret, now: fixedNow,
    });
    const retry = await submitLead(submission("00000000-0000-4000-8000-000000000001"), ipHmac, {
      repository, crm, hmacSecret: secret, now: fixedNow,
    });
    expect(first.status).toBe("accepted");
    expect(retry).toEqual(first);
    expect(crm.upsertRequest).toHaveBeenCalledTimes(1);

    const duplicate = await submitLead(submission("00000000-0000-4000-8000-000000000002"), ipHmac, {
      repository, crm, hmacSecret: secret, now: fixedNow,
    });
    expect(duplicate).toEqual({ status: "accepted", analyticsEligible: false });
    expect(JSON.stringify(duplicate)).not.toContain("owner.alias@example.test");
    expect(crm.upsertRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects requestId reuse with a changed payload", async () => {
    const repository = new MemoryLeadRepository();
    const crm = crmWith();
    const id = "00000000-0000-4000-8000-000000000003";
    await submitLead(submission(id), ipHmac, { repository, crm, hmacSecret: secret, now: fixedNow });
    const changed = await submitLead(submission(id, "different.alias@example.test"), ipHmac, {
      repository, crm, hmacSecret: secret, now: fixedNow,
    });
    expect(changed).toEqual({ status: "conflict" });
    expect(crm.upsertRequest).toHaveBeenCalledTimes(1);
  });

  it("makes the sixth attempt in ten minutes rate limited", async () => {
    const repository = new MemoryLeadRepository();
    const crm = crmWith();
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => submitLead(
      submission(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, `alias${index}@example.test`),
      ipHmac,
      { repository, crm, hmacSecret: secret, now: fixedNow },
    )));
    expect(results.filter((result) => result.status === "rate_limited")).toHaveLength(1);
    expect(crm.upsertRequest).toHaveBeenCalledTimes(5);
  });

  it("allows retry after CRM failure without exposing provider details", async () => {
    const repository = new MemoryLeadRepository();
    const crm = { upsertRequest: vi.fn<CrmContacts["upsertRequest"]>()
      .mockResolvedValueOnce({ ok: false, code: "crm_unavailable" })
      .mockRejectedValueOnce(new Error("private provider payload"))
      .mockResolvedValueOnce({ ok: true, value: { accepted: true } }) } satisfies CrmContacts;
    const lead = submission("00000000-0000-4000-8000-000000000009");
    const first = await submitLead(lead, ipHmac, { repository, crm, hmacSecret: secret, now: fixedNow });
    const second = await submitLead(lead, ipHmac, { repository, crm, hmacSecret: secret, now: fixedNow });
    const accepted = await submitLead(lead, ipHmac, { repository, crm, hmacSecret: secret, now: fixedNow });
    expect(first).toEqual({ status: "unavailable" });
    expect(second).toEqual({ status: "unavailable" });
    expect(accepted.status).toBe("accepted");
    expect(JSON.stringify([first, second, accepted])).not.toContain("private provider payload");
    expect(crm.upsertRequest).toHaveBeenCalledTimes(3);
  });

  it("keeps parallel same-request accepted responses on one conversion", async () => {
    const repository = new MemoryLeadRepository();
    const crm = crmWith();
    const lead = submission("00000000-0000-4000-8000-000000000010");
    const results = await Promise.all([lead, lead].map((value) => submitLead(value, ipHmac, {
      repository, crm, hmacSecret: secret, now: fixedNow,
    })));
    expect(results[0]).toEqual(results[1]);
    expect(results[0].status).toBe("accepted");
  });
});
