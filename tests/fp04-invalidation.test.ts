import { describe, expect, it, vi } from "vitest";
import { encodeSignatureHeader } from "@sanity/webhook";
import { handleMetricsInvalidation, handlePublicationInvalidation } from "../src/server/invalidation/handlers";

const secret = "fixture-only-invalidation-secret-32-characters";
const publication = { schemaVersion: 1, environment: "development", dataset: "development", documentId: "prd_fixture", documentType: "product" };
async function signed(body: unknown, signatureSecret = secret): Promise<Request> {
  const raw = JSON.stringify(body);
  return new Request("http://fixture.invalid/api/revalidate/", { method: "POST", headers: { "sanity-webhook-signature": await encodeSignatureHeader(raw, Date.now(), signatureSecret) }, body: raw });
}
const publicationInput = (invalidate = vi.fn()) => ({ secret, environment: "development" as const, dataset: "development", invalidate });
function metricsRequest(body: unknown, authorization = `Bearer ${secret}`): Request {
  return new Request("http://fixture.invalid/api/import-revalidate/", { method: "POST", headers: { authorization }, body: JSON.stringify(body) });
}
const metrics = { schemaVersion: 1, environment: "development", productIds: ["prd_fixture"] };
const metricsInput = (invalidate = vi.fn()) => ({ secret, environment: "development" as const, publishedProductIds: async () => ["prd_fixture"], invalidate });

describe("publication invalidation trust boundary", () => {
  it("rejects missing and wrong signatures without invalidating", async () => {
    const input = publicationInput();
    expect((await handlePublicationInvalidation(new Request("http://fixture.invalid"), input)).status).toBe(401);
    expect((await handlePublicationInvalidation(await signed(publication, "another-fixture-secret"), input)).status).toBe(401);
    expect(input.invalidate).not.toHaveBeenCalled();
  });
  it("verifies exact raw bytes before interpreting the payload", async () => {
    const raw = JSON.stringify(publication);
    const request = new Request("http://fixture.invalid", { method: "POST", headers: { "sanity-webhook-signature": await encodeSignatureHeader(raw, Date.now(), secret) }, body: ` ${raw}` });
    expect((await handlePublicationInvalidation(request, publicationInput())).status).toBe(401);
  });
  it("allows valid repeat events and waits for consistency before invalidating", async () => {
    const order: string[] = [];
    const input = { ...publicationInput(), waitForConsistency: async () => { order.push("wait"); }, invalidate: () => { order.push("invalidate"); } };
    for (let i = 0; i < 2; i++) expect((await handlePublicationInvalidation(await signed(publication), input)).status).toBe(200);
    expect(order).toEqual(["wait", "invalidate", "wait", "invalidate"]);
  });
  it.each([{ environment: "production" }, { dataset: "production" }, { documentId: "drafts.prd_fixture" }, { documentId: "versions.release.prd_fixture" }, { documentType: "privateLead" }, { tags: ["arbitrary"] }])("rejects foreign, draft or extra payload fields: %j", async (changes) => {
    const input = publicationInput();
    expect((await handlePublicationInvalidation(await signed({ ...publication, ...changes }), input)).status).toBe(400);
    expect(input.invalidate).not.toHaveBeenCalled();
  });
  it("bounds actual streamed bytes even without content-length", async () => {
    const input = publicationInput();
    expect((await handlePublicationInvalidation(await signed({ ...publication, excess: "x".repeat(16_384) }), input)).status).toBe(400);
    expect(input.invalidate).not.toHaveBeenCalled();
  });
  it("returns retryable503 without exposing SDK errors", async () => {
    const response = await handlePublicationInvalidation(await signed(publication), { ...publicationInput(), invalidate: () => { throw new Error("private fixture detail"); } });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"unavailable"}');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("collector invalidation trust boundary", () => {
  it("accepts only authenticated published product IDs", async () => {
    const input = metricsInput();
    expect((await handleMetricsInvalidation(metricsRequest(metrics), input)).status).toBe(200);
    expect(input.invalidate).toHaveBeenCalledWith(["prd_fixture"]);
    expect((await handleMetricsInvalidation(metricsRequest(metrics, "Bearer incorrect"), input)).status).toBe(401);
  });
  it.each([{ environment: "production" }, { productIds: ["prd_foreign"] }, { productIds: ["prd_fixture", "prd_fixture"] }, { productIds: [] }, { productIds: ["drafts.prd_fixture"] }, { tags: ["unsafe"] }])("rejects untrusted payload %j", async (changes) => {
    const input = metricsInput();
    expect((await handleMetricsInvalidation(metricsRequest({ ...metrics, ...changes }), input)).status).toBe(400);
    expect(input.invalidate).not.toHaveBeenCalled();
  });
  it("does not turn a CMS outage into an invalid-ID result", async () => {
    const response = await handleMetricsInvalidation(metricsRequest(metrics), { ...metricsInput(), publishedProductIds: async () => undefined });
    expect(response.status).toBe(503);
  });
});
