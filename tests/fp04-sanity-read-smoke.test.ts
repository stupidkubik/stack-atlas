import { describe, expect, it, vi } from "vitest";
import {
  readDraftPreviewDocumentCounts,
  readPublishedDocumentCounts,
} from "../src/server/sanity/read-smoke";

const target = {
  projectId: "synthetic-project",
  dataset: "development",
  apiVersion: "2026-10-05",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Sanity published read smoke", () => {
  it("uses the explicit published perspective and only reads aggregate counts", async () => {
    const fetcher = vi.fn(async (requestUrl: URL, requestInit?: RequestInit) => {
      void requestUrl;
      void requestInit;
      return jsonResponse({ result: { products: 3, packages: 2, repositories: 3 } });
    });

    const result = await readPublishedDocumentCounts(target, fetcher);

    expect(result).toEqual({
      ok: true,
      value: { products: 3, packages: 2, repositories: 3 },
    });
    const [input, init] = fetcher.mock.calls[0];
    expect(input.hostname).toBe("synthetic-project.api.sanity.io");
    expect(input.pathname).toBe("/v2026-10-05/data/query/development");
    expect(input.searchParams.get("perspective")).toBe("published");
    expect(input.searchParams.get("query")).toContain('count(*[_type == "product"])');
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ accept: "application/json" });
    expect(JSON.stringify(result)).not.toContain("synthetic-project");
  });

  it("treats a published-empty target as a successful read with zero counts", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ result: { products: 0, packages: 0, repositories: 0 } }));

    await expect(readPublishedDocumentCounts(target, fetcher)).resolves.toEqual({
      ok: true,
      value: { products: 0, packages: 0, repositories: 0 },
    });
  });

  it("returns a safe failure when the API request throws", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("private-project-response-secret");
    });

    const result = await readPublishedDocumentCounts(target, fetcher);
    expect(result).toEqual({ ok: false, code: "cms_unavailable" });
    expect(JSON.stringify(result)).not.toContain("private-project-response-secret");
  });

  it("uses the server read token only for draft-perspective aggregate preview reads", async () => {
    const token = "preview-token-sentinel";
    const fetcher = vi.fn(async (requestUrl: URL, requestInit?: RequestInit) => {
      void requestUrl;
      void requestInit;
      return jsonResponse({ result: { products: 0, packages: 0, repositories: 0 } });
    });

    const result = await readDraftPreviewDocumentCounts(target, token, fetcher);

    expect(result).toEqual({
      ok: true,
      value: { products: 0, packages: 0, repositories: 0 },
    });
    const [input, init] = fetcher.mock.calls[0];
    expect(input.hostname).toBe("synthetic-project.api.sanity.io");
    expect(input.searchParams.get("perspective")).toBe("drafts");
    expect(input.searchParams.get("query")).toContain("count(");
    expect(input.searchParams.get("query")).not.toContain("drafts.");
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({
      accept: "application/json",
      authorization: `Bearer ${token}`,
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("does not make a draft-perspective request without a read token", async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      result: { products: 0, packages: 0, repositories: 0 },
    }));

    await expect(readDraftPreviewDocumentCounts(target, "   ", fetcher)).resolves.toEqual({
      ok: false,
      code: "cms_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not return provider error bodies or malformed counts", async () => {
    const providerError = "private-project-response-secret";
    const fetcher = vi.fn(async () => jsonResponse({
      error: { description: providerError },
      result: { products: -1, packages: 0, repositories: "unknown" },
    }));

    const result = await readPublishedDocumentCounts(target, fetcher);
    expect(result).toEqual({ ok: false, code: "invalid_response" });
    expect(JSON.stringify(result)).not.toContain(providerError);
  });

  it("classifies non-success HTTP responses without exposing status details", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: "private details" }, 403));

    await expect(readPublishedDocumentCounts(target, fetcher)).resolves.toEqual({
      ok: false,
      code: "cms_unavailable",
    });
  });
});
