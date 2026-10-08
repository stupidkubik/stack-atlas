import { describe, expect, it } from "vitest";
import { parseCacheRefreshArgs, runCacheRefreshCli } from "../scripts/cache-refresh";

const argv = ["--env", "development", "--product-id", "prd_cache_retry"];
const source = { APP_ENV: "development", SITE_URL: "http://localhost:3000/", IMPORT_INVALIDATION_SECRET: "x".repeat(40) };

describe("cache refresh recovery command", () => {
  it.each([
    [], ["--env", "fixture", "--product-id", "prd_cache_retry"],
    ["--env", "production", "--product-id", "prd_cache_retry"],
    [...argv, "--allow-production"], [...argv, "--product-id", "prd_cache_retry"],
    [...argv, "--product-id", "drafts.prd_cache_retry"], [...argv, "--unexpected"],
  ].map((args) => [args]))("rejects unsafe arguments: %j", (args) => {
    expect(() => parseCacheRefreshArgs(args)).toThrow("cache_refresh_invalid_arguments");
  });

  it("retries exactly the same invalidation payload after failure, without collection", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("http://localhost:3000/api/import-revalidate/");
      requests.push(String(init?.body));
      return new Response(null, { status: requests.length === 1 ? 503 : 200 });
    };
    await expect(runCacheRefreshCli(argv, source, fetcher)).rejects.toThrow("metrics_invalidation_failed");
    await expect(runCacheRefreshCli(argv, source, fetcher)).resolves.toEqual({ environment: "development", products: 1, cacheInvalidation: "succeeded" });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  });

  it("rejects target mismatch and untrusted PR before network access", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response(); };
    for (const changed of [{ APP_ENV: "production" }, { GITHUB_EVENT_NAME: "pull_request" }]) {
      await expect(runCacheRefreshCli(argv, { ...source, ...changed }, fetcher)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });
});
