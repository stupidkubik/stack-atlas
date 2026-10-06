import "server-only";
import { timingSafeEqual } from "node:crypto";
import { isValidSignature, SIGNATURE_HEADER_NAME } from "@sanity/webhook";
import { isProductId } from "../../domain/ids";

const MAX_BODY_BYTES = 16_384;
const DOCUMENT_TYPES = new Set(["product", "productContent", "category", "categoryContent", "package", "repository", "comparison", "comparisonContent", "page", "siteSettings", "redirect", "aiReview"]);
const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const reply = (status: number) => Response.json({ status: status === 200 ? "invalidated" : status === 401 ? "unauthorized" : status === 400 ? "invalid_payload" : "unavailable" }, { status, headers });

async function boundedBody(request: Request): Promise<string | undefined> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return undefined;
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return undefined; }
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return undefined; }
  finally { reader.releaseLock(); }
}

function object(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function matchesBearer(value: string | null, secret: string): boolean {
  if (!value || value.length > 512 || !value.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function handlePublicationInvalidation(request: Request, input: {
  readonly secret: string;
  readonly environment: "development" | "production";
  readonly dataset: string;
  readonly invalidate: () => void | Promise<void>;
  readonly waitForConsistency?: () => Promise<void>;
}): Promise<Response> {
  const signature = request.headers.get(SIGNATURE_HEADER_NAME);
  if (!signature || signature.length > 512) return reply(401);
  const raw = await boundedBody(request);
  if (raw === undefined) return reply(400);
  try { if (!await isValidSignature(raw, signature, input.secret)) return reply(401); }
  catch { return reply(401); }
  const body = object(raw);
  if (!body || !exactKeys(body, ["schemaVersion", "environment", "dataset", "documentId", "documentType"]) ||
    body.schemaVersion !== 1 || body.environment !== input.environment || body.dataset !== input.dataset ||
    typeof body.documentType !== "string" || !DOCUMENT_TYPES.has(body.documentType) ||
    typeof body.documentId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(body.documentId) ||
    body.documentId.startsWith("drafts.") || body.documentId.startsWith("versions.")) return reply(400);
  try {
    await input.waitForConsistency?.();
    await input.invalidate();
    return reply(200);
  } catch { return reply(503); }
}

export async function handleMetricsInvalidation(request: Request, input: {
  readonly secret: string;
  readonly environment: "development" | "production";
  readonly publishedProductIds: () => Promise<readonly string[] | undefined>;
  readonly invalidate: (productIds: readonly string[]) => void | Promise<void>;
}): Promise<Response> {
  if (!matchesBearer(request.headers.get("authorization"), input.secret)) return reply(401);
  const raw = await boundedBody(request);
  const body = raw === undefined ? undefined : object(raw);
  if (!body || !exactKeys(body, ["schemaVersion", "environment", "productIds"]) || body.schemaVersion !== 1 ||
    body.environment !== input.environment || !Array.isArray(body.productIds) || !body.productIds.length ||
    body.productIds.length > 50 || !body.productIds.every(isProductId) || new Set(body.productIds).size !== body.productIds.length) return reply(400);
  try {
    const publishedIds = await input.publishedProductIds();
    if (!publishedIds) return reply(503);
    const allowed = new Set(publishedIds);
    if (!body.productIds.every((id) => allowed.has(id))) return reply(400);
    await input.invalidate(body.productIds);
    return reply(200);
  } catch { return reply(503); }
}
