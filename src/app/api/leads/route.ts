import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";
import {
  createContactPermission,
  isLeadScenario,
  normalizeLeadEmail,
  type LeadSubmission,
} from "@/domain/leads";
import { isEventId } from "@/domain/ids";
import { utcDateTime } from "@/domain/utc";
import { trustedOrigins } from "@/server/config/origins";
import { hashLeadIp, submitLead } from "@/server/leads/submit";
import { getLeadRuntime } from "@/server/leads/runtime";
import { plainDataRecord } from "@/domain/safe-objects";

export const runtime = "nodejs";
const maxBodyBytes = 4 * 1024;
const privateResponseHeaders = { "Cache-Control": "no-store" };
const invalidResponse = () => NextResponse.json({ status: "invalid" }, { status: 400, headers: privateResponseHeaders });
const unavailableResponse = () => NextResponse.json({ status: "unavailable" }, { status: 503, headers: privateResponseHeaders });

async function readBoundedJson(request: NextRequest): Promise<unknown | undefined> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return undefined;
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBodyBytes)) {
    return undefined;
  }
  if (!request.body) return undefined;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytesRead += result.value.byteLength;
      if (bytesRead > maxBodyBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

function validOrigin(request: NextRequest, environment: "fixture" | "development" | "production"): boolean {
  const originValue = request.headers.get("origin");
  if (!originValue || originValue === "null") return false;
  try {
    const origin = new URL(originValue);
    return origin.origin === originValue && trustedOrigins(environment).includes(origin.origin);
  } catch {
    return false;
  }
}

function clientAddress(request: NextRequest, environment: "fixture" | "development" | "production"): string {
  const forwarded = request.headers.get("x-real-ip")?.trim();
  if (forwarded && isIP(forwarded)) return forwarded.toLowerCase();
  if (environment === "fixture") return "fixture-unknown-client";
  return "unavailable-client-address";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let leadRuntime;
  try {
    leadRuntime = await getLeadRuntime();
  } catch {
    return unavailableResponse();
  }
  if (!validOrigin(request, leadRuntime.environment)) {
    return NextResponse.json({ status: "invalid" }, { status: 403, headers: privateResponseHeaders });
  }

  const rawBody = await readBoundedJson(request);
  const record = plainDataRecord(rawBody);
  if (!record) return invalidResponse();

  const now = new Date();
  let nowIso;
  try {
    nowIso = utcDateTime(now.toISOString());
  } catch {
    return unavailableResponse();
  }
  const address = clientAddress(request, leadRuntime.environment);
  const ipHmac = hashLeadIp(leadRuntime.hmacSecret, address);
  try {
    if (!await leadRuntime.repository.consumeRateLimit(ipHmac, nowIso)) {
      return NextResponse.json({ status: "rate_limited" }, { status: 429, headers: privateResponseHeaders });
    }
  } catch {
    return unavailableResponse();
  }

  // Honeypot submissions receive a neutral result and never reach CRM or analytics.
  if (typeof record.website === "string" && record.website.length > 0) {
    return NextResponse.json({ status: "accepted", analyticsEligible: false }, { headers: privateResponseHeaders });
  }

  const allowedKeys = new Set(["requestId", "email", "scenario", "contactPermission", "website"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return invalidResponse();
  const email = normalizeLeadEmail(record.email);
  if (
    !email || !isLeadScenario(record.scenario) || record.contactPermission !== true ||
    typeof record.requestId !== "string" || !isEventId(record.requestId)
  ) return invalidResponse();

  const submission: LeadSubmission = {
    requestId: record.requestId,
    email,
    scenario: record.scenario,
    contactPermission: createContactPermission(nowIso),
  };
  const result = await submitLead(submission, ipHmac, {
    repository: leadRuntime.repository,
    crm: leadRuntime.crm,
    hmacSecret: leadRuntime.hmacSecret,
    now: () => now,
    rateLimitAlreadyChecked: true,
  });

  switch (result.status) {
    case "accepted":
      return NextResponse.json(result, { headers: privateResponseHeaders });
    case "invalid":
      return invalidResponse();
    case "conflict":
      return NextResponse.json(result, { status: 409, headers: privateResponseHeaders });
    case "rate_limited":
      return NextResponse.json(result, { status: 429, headers: privateResponseHeaders });
    case "unavailable":
      return unavailableResponse();
  }
}
