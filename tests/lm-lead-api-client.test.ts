import { afterEach, describe, expect, it, vi } from "vitest";
import { submitLeadForm } from "../src/features/leads/api-client";

afterEach(() => vi.unstubAllGlobals());

describe("same-origin lead API client", () => {
  it("posts to the canonical trailing-slash route without a redirect", async () => {
    const requestId = "78a8d916-f022-4120-a93a-8a97a4672aac";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(Response.json({
        status: "accepted",
        conversionId: requestId,
        analyticsEligible: true,
      }, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitLeadForm({
      requestId,
      email: "fixture@example.invalid",
      scenario: "marketing_site",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/leads/");
    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(options && "redirect" in options).toBe(false);
    expect(JSON.parse(String(options?.body))).toMatchObject({
      requestId,
      contactPermission: true,
      website: "",
    });
    expect(result.kind).toBe("result");
  });
});
