import { describe, expect, it } from "vitest";
import {
  CONTACT_PERMISSION_VERSION,
  createContactPermission,
  normalizeLeadEmail,
  parseConsentCookieValue,
  parseLeadResult,
} from "../src/domain/leads";
import { utcDateTime } from "../src/domain/utc";

describe("lead and consent domain contracts", () => {
  it("normalizes a valid email without retaining it outside the returned value", () => {
    expect(normalizeLeadEmail("  OWNER.ALIAS@example.test ")).toBe("owner.alias@example.test");
    expect(normalizeLeadEmail("not-an-email")).toBeUndefined();
    expect(normalizeLeadEmail(`x${"a".repeat(254)}@example.test`)).toBeUndefined();
    expect(normalizeLeadEmail("owner@example.test\nInjected: header")).toBeUndefined();
  });

  it("uses a versioned contact permission timestamp", () => {
    expect(createContactPermission("2026-10-06T07:00:00.000Z")).toEqual({
      accepted: true,
      version: CONTACT_PERMISSION_VERSION,
      acceptedAt: utcDateTime("2026-10-06T07:00:00.000Z"),
    });
    expect(() => createContactPermission("not-a-time")).toThrow("Invalid contact permission timestamp.");
  });

  it("accepts only the small consent cookie payload", () => {
    expect(parseConsentCookieValue({ state: "granted", policyVersion: 1 })).toEqual({
      state: "granted",
      policyVersion: 1,
    });
    expect(parseConsentCookieValue({ state: "unknown", policyVersion: 1 })).toBeUndefined();
    expect(parseConsentCookieValue({ state: "granted", policyVersion: 1, visitorId: "private" })).toBeUndefined();
    expect(parseConsentCookieValue(Object.assign(Object.create({ state: "granted" }), { policyVersion: 1 })))
      .toBeUndefined();
  });

  it("accepts only neutral duplicate or own accepted response contracts", () => {
    const conversion = "00000000-0000-4000-8000-000000000003";
    expect(parseLeadResult({ status: "accepted", analyticsEligible: false })).toEqual({
      status: "accepted",
      analyticsEligible: false,
    });
    expect(parseLeadResult({
      status: "accepted",
      analyticsEligible: true,
      conversionId: conversion,
    })).toMatchObject({ status: "accepted", analyticsEligible: true, conversionId: conversion });
    expect(parseLeadResult({ status: "accepted", analyticsEligible: false, conversionId: conversion }))
      .toBeUndefined();
    expect(parseLeadResult({ status: "accepted", analyticsEligible: true, conversionId: "not-a-uuid" }))
      .toBeUndefined();
    expect(parseLeadResult({ status: "unavailable", message: "private provider response" })).toBeUndefined();
  });
});
