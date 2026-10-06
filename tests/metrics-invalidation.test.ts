import { describe, expect, it } from "vitest";
import { productId } from "../src/domain/ids";
import { invalidateMetricsProducts } from "../src/server/collector/invalidation-client";

const source = {
  APP_ENV: "development",
  IMPORT_INVALIDATION_SECRET: "x".repeat(40),
  SITE_URL: "http://localhost:3000/",
};

describe("metrics cache invalidation client", () => {
  it("sends the versioned environment and ID allowlist to the fixed endpoint", async () => {
    let requestUrl = "";
    let request: RequestInit | undefined;
    await invalidateMetricsProducts({
      environment: "development",
      productIds: [productId("prd_cache_test")],
      source,
      fetcher: async (url, init) => {
        requestUrl = String(url);
        request = init;
        return new Response(null, { status: 204 });
      },
    });

    expect(requestUrl).toBe("http://localhost:3000/api/import-revalidate");
    expect(new Headers(request?.headers).get("authorization")).toBe(`Bearer ${source.IMPORT_INVALIDATION_SECRET}`);
    expect(JSON.parse(String(request?.body))).toEqual({
      schemaVersion: 1,
      environment: "development",
      productIds: ["prd_cache_test"],
    });
    expect(request?.redirect).toBe("error");
  });

  it("rejects mismatched environments and duplicate or malformed IDs before fetching", async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return new Response(null, { status: 204 }); };
    await expect(invalidateMetricsProducts({
      environment: "development",
      productIds: [productId("prd_cache_test")],
      source: { ...source, APP_ENV: "production" },
      fetcher,
    })).rejects.toThrow("metrics_invalidation_target_invalid");
    await expect(invalidateMetricsProducts({
      environment: "development",
      productIds: [productId("prd_cache_test"), productId("prd_cache_test")],
      source,
      fetcher,
    })).rejects.toThrow("metrics_invalidation_input_invalid");
    expect(calls).toBe(0);
  });
});
