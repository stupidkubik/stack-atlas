import { describe, expect, it } from "vitest";
import { packageId, productId, repositoryId } from "../src/domain/ids";
import type { MappingIdentity } from "../src/domain/data-contracts";
import { collectGitHubMetrics } from "../src/server/sources/github";
import { collectNpmDownloads, npmRangeInternals } from "../src/server/sources/npm";
import { MetricSourceError, requestJson } from "../src/server/sources/http-json";

const now = new Date("2026-10-06T08:00:00.000Z");
const mapping: MappingIdentity = {
  productId: productId("prd_source_test"),
  primaryPackage: { id: packageId("pkg_source_test"), packageName: "@scope/sdk" },
  primaryRepository: { id: repositoryId("repo_source_test"), owner: "vendor", name: "sdk" },
};

function completeNpmResponse(): Record<string, unknown> {
  const period = npmRangeInternals.recentCompletedWindow(now);
  return {
    package: "@scope/sdk",
    ...period,
    downloads: Array.from({ length: 30 }, (_, offset) => ({
      day: new Date(Date.parse(`${period.start}T00:00:00.000Z`) + offset * 24 * 60 * 60_000).toISOString().slice(0, 10),
      downloads: offset === 0 ? 0 : 3,
    })),
  };
}

describe("bounded public metrics sources", () => {
  it("queries one exact completed npm window and retains zero-valued days", async () => {
    let requestedUrl = "";
    const result = await collectNpmDownloads({
      mapping,
      now,
      request: async ({ url }) => { requestedUrl = url; return completeNpmResponse(); },
    });

    expect(requestedUrl).toContain("https://api.npmjs.org/downloads/range/2026-09-06:2026-10-05/%40scope%2Fsdk");
    expect(result).toMatchObject({ status: "ok", value: 87, periodStart: "2026-09-06", periodEnd: "2026-10-05" });
    expect(result?.dailySeries).toHaveLength(30);
    expect(result?.dailySeries?.[0]).toEqual({ day: "2026-09-06", downloads: 0 });
  });

  it("keeps an incomplete npm window unknown and treats a mismatched package as invalid", async () => {
    const complete = completeNpmResponse();
    const incomplete = {
      ...complete,
      downloads: (complete.downloads as Array<unknown>).slice(1),
    };
    const unknown = await collectNpmDownloads({ mapping, now, request: async () => incomplete });
    expect(unknown).toMatchObject({ status: "unknown", reason: "incomplete_period", value: null, dailySeries: null });

    const invalid = await collectNpmDownloads({
      mapping,
      now,
      request: async () => ({ ...complete, package: "somebody-elses-package" }),
    });
    expect(invalid).toMatchObject({ status: "error", reason: "source_response_invalid", value: null });
  });

  it("projects only validated GitHub repository fields and handles a missing license as unknown", async () => {
    let authorization: string | undefined;
    const results = await collectGitHubMetrics({
      mapping,
      now,
      token: "unit-test-token",
      request: async ({ headers }) => {
        authorization = headers?.authorization;
        return {
          full_name: "vendor/sdk",
          html_url: "https://github.com/vendor/sdk",
          stargazers_count: 0,
          open_issues_count: 4,
          license: null,
          arbitrary: "discarded",
        };
      },
    });

    expect(authorization).toBe("Bearer unit-test-token");
    expect(results.map(({ metric, status, value }) => [metric, status, value])).toEqual([
      ["stars", "ok", 0],
      ["open_issues", "ok", 4],
      ["license", "unknown", null],
    ]);
  });

  it("rejects a private DNS answer before fetching and retries a 429 only within the configured bound", async () => {
    let fetchCalls = 0;
    await expect(requestJson({
      url: "https://api.npmjs.org/example",
      expectedHostname: "api.npmjs.org",
      resolveHostname: async () => ["127.0.0.1"],
      fetcher: async () => { fetchCalls += 1; return Response.json({}); },
    })).rejects.toMatchObject({ code: "source_private_address_rejected" });
    expect(fetchCalls).toBe(0);

    const delays: number[] = [];
    let attempt = 0;
    const body = await requestJson({
      url: "https://api.npmjs.org/example",
      expectedHostname: "api.npmjs.org",
      resolveHostname: async () => ["8.8.8.8"],
      random: () => 0,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      fetcher: async () => {
        attempt += 1;
        return attempt === 1
          ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
          : Response.json({ accepted: true });
      },
    });
    expect(body).toEqual({ accepted: true });
    expect(attempt).toBe(2);
    expect(delays).toEqual([0]);
  });

  it("rejects redirects and oversized response bodies without following them", async () => {
    const options = {
      url: "https://api.github.com/repos/vendor/sdk",
      expectedHostname: "api.github.com",
      resolveHostname: async () => ["8.8.8.8"],
    };
    await expect(requestJson({
      ...options,
      fetcher: async () => new Response(null, { status: 302, headers: { location: "https://example.invalid" } }),
    })).rejects.toMatchObject({ code: "source_redirect_rejected" });

    let error: unknown;
    try {
      await requestJson({
        ...options,
        maxBytes: 2,
        fetcher: async () => new Response("{} ", { headers: { "content-length": "3" } }),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MetricSourceError);
    expect(error).toMatchObject({ code: "source_response_too_large" });
  });
});
