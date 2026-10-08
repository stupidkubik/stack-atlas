import type { ProductId } from "./ids";
import type { MetricsCurrentRow, MappingIdentity } from "./data-contracts";
import { isFutureTimestampWithinTolerance } from "./data-contracts";
import type { UtcDateTime } from "./utc";

export type MetricsFreshness = "fresh" | "stale" | "missing" | "not_applicable";

export interface MetricReadValue {
  readonly productId: ProductId;
  readonly source: "npm" | "github" | null;
  readonly metric: "downloads_30d" | "stars" | "open_issues" | "license";
  readonly identity: string | null;
  readonly status: "ok" | "error" | "unknown" | "not_applicable" | "not_collected";
  readonly reason: string | null;
  readonly value: number | string | null;
  readonly lastAttemptAt: UtcDateTime | null;
  readonly observedAt: UtcDateTime | null;
  readonly fetchedAt: UtcDateTime | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly dailySeries: readonly { readonly day: string; readonly downloads: number }[] | null;
  readonly freshness: MetricsFreshness;
}

const freshForMs = 48 * 60 * 60_000;

function withinFreshWindow(value: UtcDateTime | null, now: Date): boolean {
  if (!value || !isFutureTimestampWithinTolerance(value, now)) return false;
  const age = now.getTime() - Date.parse(value);
  return age >= 0 && age <= freshForMs;
}

function expectedIdentity(mapping: MappingIdentity, source: "npm" | "github"):
  | { readonly sourceEntityId: string; readonly identity: string }
  | undefined {
  if (source === "npm" && mapping.primaryPackage) {
    return { sourceEntityId: mapping.primaryPackage.id, identity: mapping.primaryPackage.packageName };
  }
  if (source === "github" && mapping.primaryRepository) {
    return {
      sourceEntityId: mapping.primaryRepository.id,
      identity: `${mapping.primaryRepository.owner}/${mapping.primaryRepository.name}`,
    };
  }
  return undefined;
}

function missingValue(mapping: MappingIdentity, source: "npm" | "github", metric: MetricReadValue["metric"]): MetricReadValue {
  const expected = expectedIdentity(mapping, source);
  return {
    productId: mapping.productId,
    source: expected ? source : null,
    metric,
    identity: expected?.identity ?? null,
    status: expected ? "not_collected" : "not_applicable",
    reason: expected ? "metrics_not_collected" : "source_not_selected",
    value: null,
    lastAttemptAt: null,
    observedAt: null,
    fetchedAt: null,
    periodStart: null,
    periodEnd: null,
    dailySeries: null,
    freshness: expected ? "missing" : "not_applicable",
  };
}

/** Keeps only rows for the currently published package/repository identity. */
export function buildMetricsReadModel(input: {
  readonly rows: readonly MetricsCurrentRow[];
  readonly mappings: readonly MappingIdentity[];
  readonly now?: Date;
}): readonly MetricReadValue[] {
  const now = input.now ?? new Date();
  const byKey = new Map(input.rows.map((row) => [`${row.productId}:${row.source}:${row.metric}`, row] as const));
  return input.mappings.flatMap((mapping) => {
    const expected = [
      { source: "npm" as const, metric: "downloads_30d" as const },
      { source: "github" as const, metric: "stars" as const },
      { source: "github" as const, metric: "open_issues" as const },
      { source: "github" as const, metric: "license" as const },
    ];
    return expected.map(({ source, metric }): MetricReadValue => {
      const identity = expectedIdentity(mapping, source);
      if (!identity) return missingValue(mapping, source, metric);
      const row = byKey.get(`${mapping.productId}:${source}:${metric}`);
      if (!row || row.sourceEntityId !== identity.sourceEntityId || row.sourceIdentity !== identity.identity) {
        return missingValue(mapping, source, metric);
      }
      const hasLastValid = row.validValue !== null;
      return {
        productId: row.productId,
        source,
        metric,
        identity: row.sourceIdentity,
        status: row.lastStatus,
        reason: row.lastReason,
        value: row.validValue,
        lastAttemptAt: row.lastAttemptAt,
        observedAt: row.validObservedAt,
        fetchedAt: row.validFetchedAt,
        periodStart: row.validPeriodStart,
        periodEnd: row.validPeriodEnd,
        dailySeries: row.validSeries,
        freshness: !hasLastValid ? "missing" : withinFreshWindow(row.validFetchedAt, now) ? "fresh" : "stale",
      };
    });
  });
}
