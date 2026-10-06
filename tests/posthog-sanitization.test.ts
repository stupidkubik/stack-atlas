import { beforeEach, describe, expect, it } from "vitest";
import { setConsentState } from "../src/features/measurement/consent-store";
import { sanitizeBeforeSend } from "../src/features/measurement/posthog-client";

const pageView = {
  uuid: "1",
  event: "page_viewed",
  properties: {
    eventSchemaVersion: 1,
    environment: "development",
    routeType: "lead_form",
    locale: "en",
    occurredAt: "2026-10-06T06:00:00.000Z",
    eventId: "78a8d916-f022-4120-a93a-8a97a4672aac",
    distinct_id: "anonymous-synthetic-id",
    $current_url: "https://example.invalid/en/request-shortlist/?q=synthetic",
    $referrer: "https://example.invalid/private-path",
    email: "synthetic@example.invalid",
    requestId: "synthetic-request-id",
    unknownProperty: "must be stripped",
  },
};

describe("pinned PostHog before_send allowlist", () => {
  beforeEach(() => setConsentState("granted"));

  it("retains typed event fields and anonymous ID while stripping URLs and private properties", () => {
    const result = sanitizeBeforeSend(pageView);
    expect(result?.event).toBe("page_viewed");
    expect(result?.properties).toMatchObject({
      eventSchemaVersion: 1,
      environment: "development",
      routeType: "lead_form",
      locale: "en",
      distinct_id: "anonymous-synthetic-id",
      $insert_id: "78a8d916-f022-4120-a93a-8a97a4672aac",
    });
    expect(result?.properties).not.toHaveProperty("$current_url");
    expect(result?.properties).not.toHaveProperty("$referrer");
    expect(result?.properties).not.toHaveProperty("email");
    expect(result?.properties).not.toHaveProperty("requestId");
    expect(result?.properties).not.toHaveProperty("unknownProperty");
  });

  it("drops unknown SDK events and blocks capture immediately after withdrawal", () => {
    expect(sanitizeBeforeSend({ ...pageView, event: "$autocapture" })).toBeNull();
    setConsentState("denied");
    expect(sanitizeBeforeSend(pageView)).toBeNull();
  });
});
