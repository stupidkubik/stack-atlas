import "server-only";

import { PUBLISHED_DOCUMENT_COUNTS_QUERY } from "./queries";

export interface SanityPublishedTarget {
  readonly projectId: string;
  readonly dataset: string;
  readonly apiVersion: string;
}

export interface PublishedDocumentCounts {
  readonly products: number;
  readonly packages: number;
  readonly repositories: number;
}

export type SanityReadSmokeErrorCode = "cms_unavailable" | "invalid_response";

export type SanityReadSmokeResult =
  | { readonly ok: true; readonly value: PublishedDocumentCounts }
  | { readonly ok: false; readonly code: SanityReadSmokeErrorCode };

type Fetcher = (input: URL, init?: RequestInit) => Promise<Response>;

function parseCounts(value: unknown): PublishedDocumentCounts | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const counts = value as Record<string, unknown>;
  const keys = ["products", "packages", "repositories"] as const;
  if (!keys.every((key) => Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0)) {
    return undefined;
  }
  return {
    products: counts.products as number,
    packages: counts.packages as number,
    repositories: counts.repositories as number,
  };
}

/**
 * Confirms read access to the selected published Content Lake target.
 * This deliberately returns counts only; mapping validation waits for CW schemas/seed.
 */
async function readDocumentCounts(
  target: SanityPublishedTarget,
  perspective: "published" | "drafts",
  token: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<SanityReadSmokeResult> {
  if (perspective === "drafts" && !token?.trim()) {
    return { ok: false, code: "cms_unavailable" };
  }
  const endpoint = new URL(
    `https://${target.projectId}.api.sanity.io/v${target.apiVersion}/data/query/${encodeURIComponent(target.dataset)}`,
  );
  endpoint.searchParams.set("query", PUBLISHED_DOCUMENT_COUNTS_QUERY);
  endpoint.searchParams.set("perspective", perspective);

  const headers: Record<string, string> = { accept: "application/json" };
  if (perspective === "drafts" && token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, code: "cms_unavailable" };
  }
  if (!response.ok) return { ok: false, code: "cms_unavailable" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "invalid_response" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "invalid_response" };
  }
  const result = (body as Record<string, unknown>).result;
  const counts = parseCounts(result);
  return counts ? { ok: true, value: counts } : { ok: false, code: "invalid_response" };
}

/** Published content is public by design, so this request stays anonymous. */
export function readPublishedDocumentCounts(
  target: SanityPublishedTarget,
  fetcher: Fetcher = fetch,
): Promise<SanityReadSmokeResult> {
  return readDocumentCounts(target, "published", undefined, fetcher);
}

/** Authenticated preview smoke reads counts only and never requests draft content. */
export function readDraftPreviewDocumentCounts(
  target: SanityPublishedTarget,
  token: string,
  fetcher: Fetcher = fetch,
): Promise<SanityReadSmokeResult> {
  return readDocumentCounts(target, "drafts", token, fetcher);
}
