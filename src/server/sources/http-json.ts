import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class MetricSourceError extends Error {
  readonly code: string;
  readonly retryAfterMs?: number;

  constructor(code: string, retryAfterMs?: number) {
    super(code);
    this.name = "MetricSourceError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface HttpJsonOptions {
  readonly url: string;
  readonly expectedHostname: string;
  readonly fetcher?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

const maxBodyBytes = 1_048_576;
const maxRetryAfterMs = 30_000;

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    if ([0, 10, 127].includes(a) || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113)) return false;
    return true;
  }
  if (version !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:")) return false;
  if (/^(?:fc|fd|fe[89ab]|ff)/.test(normalized)) return false;
  if (normalized.startsWith("2001:db8:") || normalized.startsWith("2001:0:") || normalized.startsWith("2002:")) return false;
  return true;
}

async function resolvePublicAddresses(hostname: string): Promise<readonly string[]> {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map(({ address }) => address);
}

function retryDelay(response: Response, now = Date.now(), random = Math.random): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - now);
  }
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - now);
  return 250 * (0.5 + random());
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new MetricSourceError("source_response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new MetricSourceError("source_response_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function requestJson(options: HttpJsonOptions): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  let lastCode = "source_network_error";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const url = new URL(options.url);
      if (
        url.protocol !== "https:" || url.hostname !== options.expectedHostname || url.username ||
        url.password || url.hash || url.port
      ) throw new MetricSourceError("source_target_invalid");
      const resolve = options.resolveHostname ?? resolvePublicAddresses;
      let addresses: readonly string[];
      try {
        addresses = await resolve(url.hostname);
      } catch {
        throw new MetricSourceError("source_dns_error");
      }
      if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
        throw new MetricSourceError("source_private_address_rejected");
      }
      const headers = new Headers({ accept: "application/json", "user-agent": "PkgCompass-metrics/1.0" });
      for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
      const response = await fetcher(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (response.status >= 300 && response.status < 400) {
        throw new MetricSourceError("source_redirect_rejected");
      }
      const throttled = response.status === 429 ||
        (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
      if (throttled) {
        lastCode = "source_rate_limited";
        if (attempt === 2) break;
        const delay = retryDelay(response, Date.now(), random);
        if (delay > maxRetryAfterMs) break;
        await sleep(delay);
        continue;
      }
      if ([408, 500, 502, 503, 504].includes(response.status)) {
        lastCode = "source_temporary_http_error";
        if (attempt === 2) break;
        await sleep(250 * (2 ** attempt) + Math.floor(random() * 250));
        continue;
      }
      if (!response.ok) throw new MetricSourceError("source_http_error");
      const text = await readLimited(response, options.maxBytes ?? maxBodyBytes);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new MetricSourceError("source_response_invalid");
      }
    } catch (error) {
      if (error instanceof MetricSourceError) {
        if (error.code !== "source_network_error" && error.code !== "source_dns_error") throw error;
        lastCode = error.code;
      } else {
        const name = error instanceof Error ? error.name : "";
        lastCode = name === "TimeoutError" || name === "AbortError" ? "source_timeout" : "source_network_error";
      }
      if (attempt === 2) break;
      await sleep(250 * (2 ** attempt) + Math.floor(random() * 250));
    }
  }
  throw new MetricSourceError(lastCode);
}

export function isRetryableSourceError(error: unknown): boolean {
  return error instanceof MetricSourceError && [
    "source_rate_limited", "source_temporary_http_error", "source_timeout", "source_network_error", "source_dns_error",
  ].includes(error.code);
}

export const httpJsonInternals = { isPublicAddress, retryDelay, readLimited };
