import type { MappingIdentity, MetricObservation } from "../../domain/data-contracts";
import { utcDateTime } from "../../domain/utc";
import { MetricSourceError, requestJson, type HttpJsonOptions } from "./http-json";

type NpmRangeResult =
  | { readonly status: "complete"; readonly series: readonly { readonly day: string; readonly downloads: number }[] }
  | { readonly status: "incomplete" }
  | { readonly status: "invalid" };

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function recentCompletedWindow(now: Date): { readonly start: string; readonly end: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = new Date(today - 24 * 60 * 60_000).toISOString().slice(0, 10);
  const start = new Date(today - 30 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  return { start, end };
}

function safePackageName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(value);
}

function parseNpmResponse(
  input: unknown,
  expectedPackage: string,
  period: { readonly start: string; readonly end: string },
): NpmRangeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: "invalid" };
  const value = input as Record<string, unknown>;
  if (value.package !== expectedPackage || value.start !== period.start || value.end !== period.end || !Array.isArray(value.downloads)) return { status: "invalid" };
  if (value.downloads.length > 30) return { status: "invalid" };
  const downloads = value.downloads.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const point = item as Record<string, unknown>;
    return isDay(point.day) && typeof point.downloads === "number" &&
      Number.isSafeInteger(point.downloads) && point.downloads >= 0
      ? { day: point.day, downloads: point.downloads }
      : undefined;
  });
  if (downloads.some((item) => !item)) return { status: "invalid" };
  const validDownloads = downloads as { readonly day: string; readonly downloads: number }[];
  const days = validDownloads.map((item) => item.day);
  if (new Set(days).size !== days.length) return { status: "invalid" };
  const periodStart = Date.parse(`${period.start}T00:00:00.000Z`);
  const periodEnd = Date.parse(`${period.end}T00:00:00.000Z`);
  if (validDownloads.some((item) => {
    const date = Date.parse(`${item.day}T00:00:00.000Z`);
    return date < periodStart || date > periodEnd;
  })) return { status: "invalid" };
  const byDay = new Map(validDownloads.map((item) => [item.day, item.downloads] as const));
  const expected: { day: string; downloads: number }[] = [];
  let complete = true;
  for (let offset = 0; offset < 30; offset += 1) {
    const date = new Date(Date.parse(`${period.start}T00:00:00.000Z`) + offset * 24 * 60 * 60_000);
    const day = date.toISOString().slice(0, 10);
    const count = byDay.get(day);
    if (count === undefined) {
      complete = false;
      continue;
    }
    expected.push({ day, downloads: count });
  }
  if (!complete) return { status: "incomplete" };
  return { status: "complete", series: expected };
}

function failedObservation(
  mapping: MappingIdentity,
  now: Date,
  period: { readonly start: string; readonly end: string },
  reason: string,
): MetricObservation {
  const pkg = mapping.primaryPackage!;
  return {
    productId: mapping.productId,
    source: "npm",
    metric: "downloads_30d",
    sourceEntityId: pkg.id,
    sourceIdentity: pkg.packageName,
    sourceUrl: `https://www.npmjs.com/package/${encodeURIComponent(pkg.packageName)}`,
    status: reason === "incomplete_period" ? "unknown" : "error",
    reason,
    value: null,
    observedAt: null,
    fetchedAt: utcDateTime(now.toISOString()),
    periodStart: period.start,
    periodEnd: period.end,
    dailySeries: null,
  };
}

export async function collectNpmDownloads(input: {
  readonly mapping: MappingIdentity;
  readonly now?: Date;
  readonly request?: (options: HttpJsonOptions) => Promise<unknown>;
  readonly fetcher?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}): Promise<MetricObservation | undefined> {
  const now = input.now ?? new Date();
  const pkg = input.mapping.primaryPackage;
  if (!pkg) return undefined;
  const period = recentCompletedWindow(now);
  if (!safePackageName(pkg.packageName)) return failedObservation(input.mapping, now, period, "source_identity_invalid");
  const url = `https://api.npmjs.org/downloads/range/${period.start}:${period.end}/${encodeURIComponent(pkg.packageName)}`;
  try {
    const request = input.request ?? requestJson;
    const response = await request({ url, expectedHostname: "api.npmjs.org", fetcher: input.fetcher, sleep: input.sleep });
    const parsed = parseNpmResponse(response, pkg.packageName, period);
    if (parsed.status === "invalid") throw new MetricSourceError("source_response_invalid");
    if (parsed.status === "incomplete") return failedObservation(input.mapping, now, period, "incomplete_period");
    const total = parsed.series.reduce((sum, item) => sum + item.downloads, 0);
    if (!Number.isSafeInteger(total)) throw new MetricSourceError("source_response_invalid");
    return {
      ...failedObservation(input.mapping, now, period, "incomplete_period"),
      status: "ok",
      reason: null,
      value: total,
      observedAt: utcDateTime(`${period.end}T23:59:59.000Z`),
      dailySeries: parsed.series,
    };
  } catch (error) {
    const reason = error instanceof MetricSourceError ? error.code : "source_error";
    return failedObservation(input.mapping, now, period, reason);
  }
}

export const npmRangeInternals = { parseNpmResponse, recentCompletedWindow };
