import { describe, expect, it } from "vitest";
import { productId } from "../src/domain/ids";
import { invalidateMetricsProducts } from "../src/server/collector/invalidation-client";

const source = {
  APP_ENV: "development",
  GITHUB_REF: "refs/heads/work/foundation-first-pass",
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

    expect(requestUrl).toBe("http://localhost:3000/api/import-revalidate/");
    const headers = new Headers(request?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${source.IMPORT_INVALIDATION_SECRET}`);
    expect(headers.get("x-vercel-trusted-oidc-idp-token")).toBeNull();
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

  it("forwards OIDC only to the approved HTTPS development preview from the dispatch ref", async () => {
    const oidcToken = "fixture-vercel-oidc-token";
    let request: RequestInit | undefined;

    await invalidateMetricsProducts({
      environment: "development",
      productIds: [productId("prd_cache_test")],
      source: {
        ...source,
        SITE_URL: "https://pkg-compass-git-work-foundati-aea6dd-evgeniis-projects-0daccd9a.vercel.app/",
        VERCEL_OIDC_TOKEN: oidcToken,
      },
      fetcher: async (_url, init) => {
        request = init;
        return new Response(null, { status: 204 });
      },
    });

    const headers = new Headers(request?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${source.IMPORT_INVALIDATION_SECRET}`);
    expect(headers.get("x-vercel-trusted-oidc-idp-token")).toBe(oidcToken);
  });

  it("never forwards OIDC to custom, loopback, or production origins", async () => {
    const oidcToken = "fixture-vercel-oidc-token";
    const cases = [
      {
        environment: "development" as const,
        source: { ...source, SITE_URL: "https://preview.example.net/", VERCEL_OIDC_TOKEN: oidcToken },
      },
      {
        environment: "development" as const,
        source: { ...source, SITE_URL: "https://another-project.vercel.app/", VERCEL_OIDC_TOKEN: oidcToken },
      },
      {
        environment: "development" as const,
        source: { ...source, SITE_URL: "http://localhost:3000/", VERCEL_OIDC_TOKEN: oidcToken },
      },
      {
        environment: "production" as const,
        source: {
          ...source,
          APP_ENV: "production",
          VERCEL: "1",
          VERCEL_ENV: "production",
          SITE_URL: "https://pkgcompass-production.vercel.app/",
          VERCEL_OIDC_TOKEN: oidcToken,
        },
      },
    ];

    for (const testCase of cases) {
      let request: RequestInit | undefined;
      await invalidateMetricsProducts({
        environment: testCase.environment,
        productIds: [productId("prd_cache_test")],
        source: testCase.source,
        fetcher: async (_url, init) => {
          request = init;
          return new Response(null, { status: 204 });
        },
      });

      const headers = new Headers(request?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${source.IMPORT_INVALIDATION_SECRET}`);
      expect(headers.get("x-vercel-trusted-oidc-idp-token")).toBeNull();
    }
  });

  it("does not forward OIDC when a Vercel preview request comes from another ref", async () => {
    let request: RequestInit | undefined;
    await invalidateMetricsProducts({
      environment: "development",
      productIds: [productId("prd_cache_test")],
      source: {
        ...source,
        GITHUB_REF: "refs/pull/42/merge",
        SITE_URL: "https://pkg-compass-git-work-foundati-aea6dd-evgeniis-projects-0daccd9a.vercel.app/",
        VERCEL_OIDC_TOKEN: "fixture-vercel-oidc-token",
      },
      fetcher: async (_url, init) => {
        request = init;
        return new Response(null, { status: 204 });
      },
    });

    const headers = new Headers(request?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${source.IMPORT_INVALIDATION_SECRET}`);
    expect(headers.get("x-vercel-trusted-oidc-idp-token")).toBeNull();
  });
});
