import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_SESSION_COOKIE = "pkgcompass_preview";
export const PREVIEW_SESSION_TTL_SECONDS = 60 * 60;

type PreviewEnvironment = "development" | "production";

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createPreviewSession(input: {
  readonly secret: string;
  readonly environment: PreviewEnvironment;
  readonly now?: Date;
}): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    environment: input.environment,
    expiresAt: (input.now ?? new Date()).getTime() + PREVIEW_SESSION_TTL_SECONDS * 1000,
  })).toString("base64url");
  return `${payload}.${signature(payload, input.secret).toString("base64url")}`;
}

export function isValidPreviewSession(input: {
  readonly value: string | undefined;
  readonly secret: string;
  readonly environment: PreviewEnvironment;
  readonly now?: Date;
}): boolean {
  if (!input.value || input.value.length > 512) return false;
  const [payload, encodedSignature, ...rest] = input.value.split(".");
  if (!payload || !encodedSignature || rest.length > 0) return false;
  let actual: Buffer;
  let decoded: unknown;
  try {
    actual = Buffer.from(encodedSignature, "base64url");
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  const expected = signature(payload, input.secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) return false;
  const session = decoded as Record<string, unknown>;
  return session.version === 1 && session.environment === input.environment &&
    Number.isSafeInteger(session.expiresAt) && Number(session.expiresAt) > (input.now ?? new Date()).getTime();
}

/** Presentation may redirect only to a known public route, with no query secrets. */
export function safePreviewRedirect(value: string | undefined): string | undefined {
  if (!value || value.length > 512 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return undefined;
  let parsed: URL;
  try { parsed = new URL(value, "https://pkgcompass.invalid"); } catch { return undefined; }
  if (parsed.origin !== "https://pkgcompass.invalid" || parsed.search || parsed.hash) return undefined;
  const path = parsed.pathname;
  return path === "/en/" || path === "/en/methodology/ai-readiness/" ||
    path === "/en/privacy/" || /^\/en\/categories\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(path) ||
    /^\/en\/tools\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(path) ||
    /^\/en\/compare\/[a-z0-9]+(?:-[a-z0-9]+)*-vs-[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(path)
    ? path : undefined;
}
