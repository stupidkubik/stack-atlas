import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { unpackPosthogEvents } from "../scripts/dev/posthog-smoke-transport.mjs";

const safeEvent = { event: "page_viewed", properties: { routeType: "home" } };
const payload = JSON.stringify({ batch: [safeEvent], sent_at: "synthetic" });

describe("PostHog browser smoke transport decoder", () => {
  it("reads plain JSON event envelopes", () => {
    expect(unpackPosthogEvents(Buffer.from(payload), "https://eu.i.posthog.com/e/", undefined)).toEqual([safeEvent]);
  });

  it("reads the pinned gzip-js binary envelope without persisting the body", () => {
    expect(unpackPosthogEvents(gzipSync(Buffer.from(payload)), "https://eu.i.posthog.com/e/?compression=gzip-js", undefined)).toEqual([safeEvent]);
  });

  it("recognizes pinned gzip-js bodies after the SDK removes the compression query", () => {
    expect(unpackPosthogEvents(gzipSync(Buffer.from(payload)), "https://eu.i.posthog.com/e/", undefined)).toEqual([safeEvent]);
  });

  it("reads the pinned base64 form envelope", () => {
    const encoded = Buffer.from(encodeURIComponent(payload)).toString("base64");
    expect(unpackPosthogEvents(Buffer.from(`data=${encodeURIComponent(encoded)}`), "https://eu.i.posthog.com/e/?compression=base64", undefined)).toEqual([safeEvent]);
  });

  it("fails closed for malformed, oversized, or non-event bodies", () => {
    expect(unpackPosthogEvents(Buffer.from("not-json"), "https://eu.i.posthog.com/e/", undefined)).toEqual([]);
    expect(unpackPosthogEvents(Buffer.alloc(1_000_001), "https://eu.i.posthog.com/e/", undefined)).toEqual([]);
    expect(unpackPosthogEvents(Buffer.from(JSON.stringify({ batch: [{ properties: {} }] })), "https://eu.i.posthog.com/e/", undefined)).toEqual([]);
  });
});
