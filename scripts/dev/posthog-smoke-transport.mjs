import { gunzipSync } from "node:zlib";

const maxCompressedBodyBytes = 1_000_000;
const maxDecodedBodyBytes = 4_000_000;

function decodeBody(body, urlValue, contentEncoding) {
  if (!body || body.byteLength === 0 || body.byteLength > maxCompressedBodyBytes) return undefined;
  let bytes = Buffer.from(body);
  let encoding = "";
  try { encoding = new URL(urlValue).searchParams.get("compression") ?? ""; } catch { return undefined; }

  if (encoding === "base64") {
    const form = new URLSearchParams(bytes.toString("utf8"));
    const data = form.get("data");
    if (!data || data.length > maxCompressedBodyBytes) return undefined;
    try { bytes = Buffer.from(decodeURIComponent(Buffer.from(data, "base64").toString("utf8")), "utf8"); }
    catch { return undefined; }
  } else if (
    encoding === "gzip-js" || contentEncoding?.toLowerCase() === "gzip" ||
    (bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)
  ) {
    try { bytes = gunzipSync(bytes, { maxOutputLength: maxDecodedBodyBytes }); }
    catch { return undefined; }
  }

  if (bytes.byteLength > maxDecodedBodyBytes) return undefined;
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return undefined; }
}

/** Parses pinned PostHog transport formats in memory and returns only event names and properties. */
export function unpackPosthogEvents(body, url, contentEncoding) {
  const value = decodeBody(body, url, contentEncoding);
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidates = Array.isArray(value.batch) ? value.batch : [value];
  return candidates.flatMap((candidate) =>
    candidate && typeof candidate === "object" && !Array.isArray(candidate) && typeof candidate.event === "string"
      ? [{ event: candidate.event, properties: candidate.properties ?? {} }]
      : [],
  );
}
