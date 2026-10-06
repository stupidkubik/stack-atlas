import {
  isPackageId,
  isProductId,
  isRepositoryId,
  packageId,
  productId,
  repositoryId,
  type PackageId,
  type ProductId,
  type RepositoryId,
} from "./ids";
import { denseDataArray, plainDataRecord } from "./safe-objects";
import { isUtcDateTime, type UtcDateTime } from "./utc";
import type { CurrentMetric } from "./metrics";

export type MetricSource = "npm" | "github";
export type MetricName = "downloads_30d" | "stars" | "open_issues" | "license";
export type MetricStatus = "ok" | "error" | "unknown" | "not_applicable";
export type MetricValue = number | string;

export interface MetricObservation {
  readonly productId: ProductId;
  readonly source: MetricSource;
  readonly metric: MetricName;
  readonly sourceEntityId: PackageId | RepositoryId;
  readonly sourceIdentity: string;
  readonly sourceUrl: string;
  readonly status: MetricStatus;
  readonly reason: string | null;
  readonly value: MetricValue | null;
  readonly observedAt: UtcDateTime | null;
  readonly fetchedAt: UtcDateTime;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly dailySeries: readonly { readonly day: string; readonly downloads: number }[] | null;
}

export interface MetricsCurrentRow {
  readonly productId: ProductId;
  readonly source: MetricSource;
  readonly metric: MetricName;
  readonly sourceEntityId: PackageId | RepositoryId;
  readonly sourceIdentity: string;
  readonly sourceUrl: string;
  readonly lastAttemptAt: UtcDateTime;
  readonly lastStatus: MetricStatus;
  readonly lastReason: string | null;
  readonly validValue: MetricValue | null;
  readonly validObservedAt: UtcDateTime | null;
  readonly validFetchedAt: UtcDateTime | null;
  readonly validPeriodStart: string | null;
  readonly validPeriodEnd: string | null;
  readonly validSeries: readonly { readonly day: string; readonly downloads: number }[] | null;
  readonly runId: string;
  readonly updatedAt: UtcDateTime;
}

export interface MappingIdentity {
  readonly productId: ProductId;
  readonly primaryPackage: { readonly id: PackageId; readonly packageName: string } | null;
  readonly primaryRepository: { readonly id: RepositoryId; readonly owner: string; readonly name: string } | null;
}

const maximumFutureSkewMs = 5 * 60_000;
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const reasonPattern = /^[a-z][a-z0-9_]{0,63}$/;

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !dayPattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search;
  } catch {
    return false;
  }
}

function validInstant(value: unknown, now: Date): value is UtcDateTime {
  return isUtcDateTime(value) && Date.parse(value) <= now.getTime() + maximumFutureSkewMs;
}

export function parseMappingIdentity(input: unknown): MappingIdentity | undefined {
  const record = plainDataRecord(input);
  if (!record || !isProductId(record.productId)) return undefined;
  const pkg = record.primaryPackage === null ? null : plainDataRecord(record.primaryPackage);
  const repo = record.primaryRepository === null ? null : plainDataRecord(record.primaryRepository);
  if (record.primaryPackage !== null && (
    !pkg || !isPackageId(pkg.id) || typeof pkg.packageName !== "string" || !pkg.packageName.trim() ||
      pkg.packageName.trim() !== pkg.packageName
  )) return undefined;
  if (record.primaryRepository !== null && (
    !repo || !isRepositoryId(repo.id) || typeof repo.owner !== "string" || !repo.owner.trim() ||
      repo.owner.trim() !== repo.owner || typeof repo.name !== "string" || !repo.name.trim() || repo.name.trim() !== repo.name
  )) return undefined;
  return {
    productId: productId(record.productId),
    primaryPackage: pkg ? { id: packageId(pkg.id as string), packageName: pkg.packageName as string } : null,
    primaryRepository: repo ? {
      id: repositoryId(repo.id as string), owner: repo.owner as string, name: repo.name as string,
    } : null,
  };
}

export function parseMetricObservation(input: unknown, now = new Date()): MetricObservation | undefined {
  const row = plainDataRecord(input);
  if (!row || !isProductId(row.productId) || !isUtcDateTime(row.fetchedAt) || !validInstant(row.fetchedAt, now)) return undefined;
  const source = row.source;
  const metric = row.metric;
  const npm = source === "npm" && metric === "downloads_30d" && isPackageId(row.sourceEntityId);
  const github = source === "github" && ["stars", "open_issues", "license"].includes(String(metric)) && isRepositoryId(row.sourceEntityId);
  if (!npm && !github) return undefined;
  if (
    typeof row.sourceIdentity !== "string" || !row.sourceIdentity.trim() ||
    !validUrl(row.sourceUrl) || !["ok", "error", "unknown", "not_applicable"].includes(String(row.status)) ||
    !(row.reason === null || (typeof row.reason === "string" && reasonPattern.test(row.reason))) ||
    !(row.value === null || (typeof row.value === "number" && Number.isSafeInteger(row.value) && row.value >= 0) ||
      (metric === "license" && typeof row.value === "string" && row.value.length <= 128)) ||
    !(row.observedAt === null || validInstant(row.observedAt, now)) ||
    !(row.periodStart === null || validDay(row.periodStart)) ||
    !(row.periodEnd === null || validDay(row.periodEnd))
  ) return undefined;
  if (row.status === "ok" && (row.value === null || row.observedAt === null)) return undefined;
  if (source === "npm" && row.status === "ok" && (!validDay(row.periodStart) || !validDay(row.periodEnd))) return undefined;
  if (source !== "npm" && (row.periodStart !== null || row.periodEnd !== null)) return undefined;
  const seriesInput = row.dailySeries === null ? null : denseDataArray(row.dailySeries);
  if (row.dailySeries !== null && !seriesInput) return undefined;
  const series = seriesInput?.map((item) => {
    const entry = plainDataRecord(item);
    return entry && validDay(entry.day) && Number.isSafeInteger(entry.downloads) &&
      typeof entry.downloads === "number" && entry.downloads >= 0
      ? { day: entry.day, downloads: entry.downloads }
      : undefined;
  });
  if (series?.some((entry) => entry === undefined)) return undefined;
  if (metric !== "downloads_30d" && seriesInput !== null) return undefined;
  if (series && new Set(series.map((entry) => entry?.day)).size !== series.length) return undefined;
  if (source === "npm" && row.status === "ok") {
    if (!series || series.length !== 30 || series.some((entry) => entry === undefined)) return undefined;
    const startTime = Date.parse(`${row.periodStart as string}T00:00:00.000Z`);
    const expectedDays = Array.from({ length: 30 }, (_, offset) =>
      new Date(startTime + offset * 24 * 60 * 60_000).toISOString().slice(0, 10),
    );
    const normalizedSeries = series as { readonly day: string; readonly downloads: number }[];
    const total = normalizedSeries.reduce((sum, entry) => sum + entry.downloads, 0);
    if (
      normalizedSeries.some((entry, index) => entry.day !== expectedDays[index]) ||
      normalizedSeries[29]?.day !== row.periodEnd || total !== row.value
    ) return undefined;
  }

  return {
    productId: productId(row.productId),
    source: source as MetricSource,
    metric: metric as MetricName,
    sourceEntityId: (npm ? packageId(row.sourceEntityId as string) : repositoryId(row.sourceEntityId as string)),
    sourceIdentity: row.sourceIdentity,
    sourceUrl: row.sourceUrl,
    status: row.status as MetricStatus,
    reason: row.reason as string | null,
    value: row.value as MetricValue | null,
    observedAt: row.observedAt as UtcDateTime | null,
    fetchedAt: row.fetchedAt as UtcDateTime,
    periodStart: row.periodStart as string | null,
    periodEnd: row.periodEnd as string | null,
    dailySeries: series as { readonly day: string; readonly downloads: number }[] | null,
  };
}

export function isFutureTimestampWithinTolerance(value: unknown, now = new Date()): value is UtcDateTime {
  return validInstant(value, now);
}

function timestampValue(value: unknown, now: Date): UtcDateTime | undefined {
  if (value instanceof Date && !Number.isFinite(value.getTime())) return undefined;
  const normalized = value instanceof Date ? value.toISOString() : value;
  return validInstant(normalized, now) ? normalized : undefined;
}

function nullableTimestamp(value: unknown, now: Date): UtcDateTime | null | undefined {
  if (value === null) return null;
  return timestampValue(value, now);
}

function seriesValue(value: unknown): MetricsCurrentRow["validSeries"] | undefined {
  if (value === null) return null;
  const entries = denseDataArray(value);
  if (!entries) return undefined;
  const parsed = entries.map((entry) => {
    const record = plainDataRecord(entry);
    return record && validDay(record.day) && typeof record.downloads === "number" &&
      Number.isSafeInteger(record.downloads) && record.downloads >= 0
      ? { day: record.day, downloads: record.downloads }
      : undefined;
  });
  if (parsed.some((entry) => !entry) || new Set(parsed.map((entry) => entry?.day)).size !== parsed.length) return undefined;
  return parsed as { readonly day: string; readonly downloads: number }[];
}

/** Parses the SQL row before it reaches the public read model. */
export function parseMetricsCurrentRow(input: unknown, now = new Date()): MetricsCurrentRow | undefined {
  const row = plainDataRecord(input);
  if (!row || !isProductId(row.productId)) return undefined;
  const npm = row.source === "npm" && row.metric === "downloads_30d" && isPackageId(row.sourceEntityId);
  const github = row.source === "github" && ["stars", "open_issues", "license"].includes(String(row.metric)) && isRepositoryId(row.sourceEntityId);
  const lastAttemptAt = timestampValue(row.lastAttemptAt, now);
  const updatedAt = timestampValue(row.updatedAt, now);
  const validObservedAt = nullableTimestamp(row.validObservedAt, now);
  const validFetchedAt = nullableTimestamp(row.validFetchedAt, now);
  const validSeries = seriesValue(row.validSeries);
  const validPeriodStart = row.validPeriodStart === null ? null : row.validPeriodStart;
  const validPeriodEnd = row.validPeriodEnd === null ? null : row.validPeriodEnd;
  if (
    (!npm && !github) || !lastAttemptAt || !updatedAt || validObservedAt === undefined ||
    validFetchedAt === undefined || validSeries === undefined ||
    typeof row.sourceIdentity !== "string" || !row.sourceIdentity.trim() || !validUrl(row.sourceUrl) ||
    !["ok", "error", "unknown", "not_applicable"].includes(String(row.lastStatus)) ||
    !(row.lastReason === null || (typeof row.lastReason === "string" && reasonPattern.test(row.lastReason))) ||
    !(row.validValue === null || (typeof row.validValue === "number" && Number.isSafeInteger(row.validValue) && row.validValue >= 0) ||
      (row.metric === "license" && typeof row.validValue === "string" && row.validValue.length <= 128)) ||
    !(validPeriodStart === null || validDay(validPeriodStart)) ||
    !(validPeriodEnd === null || validDay(validPeriodEnd)) ||
    (row.lastStatus === "ok" && (row.validValue === null || validObservedAt === null || validFetchedAt === null)) ||
    (row.metric === "downloads_30d" && ((validPeriodStart === null) !== (validPeriodEnd === null))) ||
    (row.metric !== "downloads_30d" && (validPeriodStart !== null || validPeriodEnd !== null || validSeries !== null)) ||
    (row.metric !== "downloads_30d" && validSeries !== null)
  ) return undefined;
  const hasValidValue = row.validValue !== null;
  if (hasValidValue !== (validObservedAt !== null && validFetchedAt !== null)) return undefined;
  if (row.metric === "downloads_30d") {
    if (hasValidValue) {
      if (!validPeriodStart || !validPeriodEnd || !validSeries || validSeries.length !== 30) return undefined;
      const startTime = Date.parse(`${validPeriodStart}T00:00:00.000Z`);
      const expectedDays = Array.from({ length: 30 }, (_, offset) =>
        new Date(startTime + offset * 24 * 60 * 60_000).toISOString().slice(0, 10),
      );
      const total = validSeries.reduce((sum, item) => sum + item.downloads, 0);
      if (
        validSeries.some((item, index) => item.day !== expectedDays[index]) ||
        validSeries[29]?.day !== validPeriodEnd || total !== row.validValue
      ) return undefined;
    } else if (validPeriodStart !== null || validPeriodEnd !== null || validSeries !== null) return undefined;
  } else if (hasValidValue && (validPeriodStart !== null || validPeriodEnd !== null || validSeries !== null)) {
    return undefined;
  }
  if (row.metric === "downloads_30d" && validSeries && (!validPeriodStart || !validPeriodEnd)) return undefined;
  if (!isUtcDateTime(lastAttemptAt) || !isUtcDateTime(updatedAt)) return undefined;
  const runId = row.runId;
  if (typeof runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) return undefined;
  return {
    productId: productId(row.productId),
    source: row.source as MetricSource,
    metric: row.metric as MetricName,
    sourceEntityId: npm ? packageId(row.sourceEntityId as string) : repositoryId(row.sourceEntityId as string),
    sourceIdentity: row.sourceIdentity,
    sourceUrl: row.sourceUrl,
    lastAttemptAt,
    lastStatus: row.lastStatus as MetricStatus,
    lastReason: row.lastReason as string | null,
    validValue: row.validValue as MetricValue | null,
    validObservedAt,
    validFetchedAt,
    validPeriodStart: validPeriodStart as string | null,
    validPeriodEnd: validPeriodEnd as string | null,
    validSeries,
    runId,
    updatedAt,
  };
}

/** Projects the persisted row into the existing adapter contract used by pages. */
export function toCurrentMetric(row: MetricsCurrentRow): CurrentMetric {
  const base = {
    productId: row.productId,
    sourceIdentity: row.sourceIdentity,
    sourceUrl: row.sourceUrl,
    lastAttemptAt: row.lastAttemptAt,
    lastStatus: row.lastStatus,
    lastReason: row.lastReason,
    validObservedAt: row.validObservedAt,
    validFetchedAt: row.validFetchedAt,
    runId: row.runId,
    updatedAt: row.updatedAt,
  };
  if (row.metric === "downloads_30d") {
    return {
      ...base,
      source: "npm",
      metric: row.metric,
      sourceEntityId: row.sourceEntityId as PackageId,
      validValue: row.validValue as number | null,
      ...(row.validPeriodStart ? { periodStart: row.validPeriodStart } : {}),
      ...(row.validPeriodEnd ? { periodEnd: row.validPeriodEnd } : {}),
      ...(row.validSeries ? { dailySeries: row.validSeries } : {}),
    };
  }
  if (row.metric === "license") {
    return {
      ...base,
      source: "github",
      metric: "license",
      sourceEntityId: row.sourceEntityId as RepositoryId,
      validValue: row.validValue as string | null,
    };
  }
  return {
    ...base,
    source: "github",
    metric: row.metric,
    sourceEntityId: row.sourceEntityId as RepositoryId,
    validValue: row.validValue as number | null,
  };
}
