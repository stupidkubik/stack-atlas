import { afterEach, describe, expect, it, vi } from "vitest";
import { submitLead } from "../src/server/leads/submit";
import { MemoryLeadRepository } from "../src/server/leads/memory-lead-repository";
import type { LeadSubmission } from "../src/domain/leads";
import type { CrmContacts } from "../src/domain/ports";
import { submitLeadForm } from "../src/features/leads/api-client";
import { summarizeComparisonFunnel, type FunnelObservation } from "../src/domain/measurement-funnel";
import type { AnalyticsEvent } from "../src/domain/measurement";
import { comparisonId, conversionId, eventId } from "../src/domain/ids";
import { utcDateTime } from "../src/domain/utc";

afterEach(() => vi.unstubAllGlobals());

let sequence = 0;
function observation(visitorId: string, name: "comparison_viewed" | "lead_form_viewed" | "lead_accepted", at: string,
  options: { conversion?: number; environment?: "development" | "production" } = {}): FunnelObservation {
  const id = `00000000-0000-4000-8000-${String(options.conversion ?? ++sequence).padStart(12, "0")}`;
  const base = { eventSchemaVersion: 1 as const, environment: options.environment ?? "development", locale: "en" as const,
    occurredAt: utcDateTime(at), eventId: eventId(id) };
  const event: AnalyticsEvent = name === "comparison_viewed"
    ? { ...base, name, routeType: "comparison", comparisonId: comparisonId("cmp_synthetic") }
    : name === "lead_form_viewed"
      ? { ...base, name, routeType: "lead_form", entryPoint: "nav" }
      : { ...base, name, routeType: "lead_form", conversionId: conversionId(id), scenario: "marketing_site" };
  return { visitorId, event };
}

describe("LM-08 independent prototype contracts", () => {
  it("forwards a populated honeypot instead of replacing it with an empty string", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ status: "accepted", analyticsEligible: false }));
    vi.stubGlobal("fetch", fetchMock);
    await submitLeadForm({ requestId: "00000000-0000-4000-8000-000000000001", email: "synthetic@example.invalid",
      scenario: "marketing_site", website: "synthetic-bot-value" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ website: "synthetic-bot-value" });
  });

  it("counts consenting comparison visitors and ordered journeys separately from operation volume", () => {
    const comparison = observation("synthetic-a", "comparison_viewed", "2026-10-01T00:00:00.000Z");
    const accepted = observation("synthetic-a", "lead_accepted", "2026-10-02T00:00:00.000Z", { conversion: 9001 });
    const data = [comparison, observation("synthetic-a", "lead_form_viewed", "2026-10-01T01:00:00.000Z"), accepted,
      accepted, comparison,
      observation("synthetic-b", "comparison_viewed", "2026-10-01T00:00:00.000Z"),
      observation("synthetic-b", "lead_form_viewed", "2026-10-08T00:00:00.001Z"),
      observation("synthetic-c", "lead_form_viewed", "2026-10-01T00:00:00.000Z"),
      observation("synthetic-c", "lead_accepted", "2026-10-02T00:00:00.000Z", { conversion: 9002 }),
      observation("synthetic-prod", "comparison_viewed", "2026-10-01T00:00:00.000Z", { environment: "production" })];
    expect(summarizeComparisonFunnel(data, "development")).toEqual({ comparisonVisitors: 2, convertedVisitors: 1,
      conversionRate: 0.5, uniqueConversions: 2 });
    expect(summarizeComparisonFunnel([], "development")).toEqual({ comparisonVisitors: 0, convertedVisitors: 0,
      conversionRate: 0, uniqueConversions: 0 });
  });

  it("includes exactly seven days and excludes one millisecond beyond the journey window", () => {
    const journey = (acceptedAt: string) => [
      observation("synthetic-window", "comparison_viewed", "2026-10-01T00:00:00.000Z"),
      observation("synthetic-window", "lead_form_viewed", "2026-10-02T00:00:00.000Z"),
      observation("synthetic-window", "lead_accepted", acceptedAt, { conversion: 9003 })];
    expect(summarizeComparisonFunnel(journey("2026-10-08T00:00:00.000Z"), "development").convertedVisitors).toBe(1);
    expect(summarizeComparisonFunnel(journey("2026-10-08T00:00:00.001Z"), "development").convertedVisitors).toBe(0);
  });

  it("rejects unordered journeys and allows a later valid comparison to start a new seven-day window", () => {
    const data = [
      observation("synthetic-order", "comparison_viewed", "2026-10-01T00:00:00.000Z"),
      observation("synthetic-order", "lead_accepted", "2026-10-03T00:00:00.000Z", { conversion: 9004 }),
      observation("synthetic-order", "lead_form_viewed", "2026-10-04T00:00:00.000Z")];
    expect(summarizeComparisonFunnel(data, "development").convertedVisitors).toBe(0);
    const restarted = [
      observation("synthetic-restart", "comparison_viewed", "2026-09-01T00:00:00.000Z"),
      observation("synthetic-restart", "comparison_viewed", "2026-10-01T00:00:00.000Z"),
      observation("synthetic-restart", "lead_form_viewed", "2026-10-02T00:00:00.000Z"),
      observation("synthetic-restart", "lead_accepted", "2026-10-03T00:00:00.000Z", { conversion: 9005 })];
    expect(summarizeComparisonFunnel(restarted, "development").convertedVisitors).toBe(1);
  });
});


describe("LM-08 independent database failure boundaries", () => {
  const request: LeadSubmission = {
    requestId: "00000000-0000-4000-8000-000000000098",
    email: "synthetic-db-failure@example.invalid",
    scenario: "marketing_site",
    contactPermission: { accepted: true, version: "contact_v1", acceptedAt: utcDateTime("2026-10-08T08:00:00.000Z") },
  };
  const hmacSecret = "synthetic-independent-db-failure-hmac-key";
  const ipHmac = "b".repeat(64);
  const now = () => new Date("2026-10-08T08:00:00.000Z");
  const crm = () => ({ upsertRequest: vi.fn<CrmContacts["upsertRequest"]>(async () => ({ ok: true, value: { accepted: true } })) });

  it.each(["consumeRateLimit", "reserve"] as const)("fails before CRM when database %s rejects, without a conversion", async (stage) => {
    const repository = new MemoryLeadRepository();
    const provider = crm();
    vi.spyOn(repository, stage).mockRejectedValueOnce(new Error("synthetic-private-database-detail"));
    const result = await submitLead(request, ipHmac, { repository, crm: provider, hmacSecret, now });
    expect(result).toEqual({ status: "unavailable" });
    expect(provider.upsertRequest).not.toHaveBeenCalled();
    expect(repository.snapshot().accepted).toBe(0);
    expect(JSON.stringify(result)).not.toContain("synthetic-private-database-detail");
  });

  it("does not claim a conversion after CRM success when acceptance cannot persist, and same-operation retry recovers", async () => {
    const repository = new MemoryLeadRepository();
    const provider = crm();
    vi.spyOn(repository, "markAccepted").mockRejectedValueOnce(new Error("synthetic-private-commit-detail"));
    const dependencies = { repository, crm: provider, hmacSecret, now };
    const uncertain = await submitLead(request, ipHmac, dependencies);
    expect(uncertain).toEqual({ status: "unavailable" });
    expect(provider.upsertRequest).toHaveBeenCalledOnce();
    expect(repository.snapshot().accepted).toBe(0);
    const retry = await submitLead(request, ipHmac, dependencies);
    expect(retry).toMatchObject({ status: "accepted", analyticsEligible: true });
    expect(repository.snapshot()).toEqual({ rows: 1, accepted: 1 });
    const repeat = await submitLead(request, ipHmac, dependencies);
    expect(repeat).toEqual(retry);
    expect(provider.upsertRequest).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([uncertain, retry, repeat])).not.toContain("synthetic-private-commit-detail");
  });
});
