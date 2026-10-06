import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ProductId } from "../../domain/ids";
import { parseMetricObservation, parseMetricsCurrentRow, toCurrentMetric, type MetricObservation } from "../../domain/data-contracts";
import type { MetricsCurrentRow } from "../../domain/data-contracts";
import { buildMetricsReadModel, type MetricReadValue } from "../../domain/metrics-read-model";
import type { MetricsReader, MetricsWriter } from "../../domain/ports";
import { metricsCurrent } from "./schema";

export function createMetricsReader(db: NodePgDatabase): MetricsReader {
  return {
    async readCurrent(productIds) {
      try {
        const rows = await readCurrentMetricsRows(db, productIds);
        return { ok: true, value: rows.map(toCurrentMetric) };
      } catch {
        return { ok: false, code: "metrics_unavailable" };
      }
    },
  };
}

export async function readCurrentMetricsRows(
  db: NodePgDatabase,
  productIds: readonly ProductId[],
): Promise<readonly MetricsCurrentRow[]> {
  if (productIds.length === 0) return [];
  const rows = await db.select().from(metricsCurrent).where(inArray(metricsCurrent.productId, [...productIds]));
  const parsed = rows.map((row) => parseMetricsCurrentRow(row));
  if (parsed.some((row) => !row)) throw new Error("metrics_row_invalid");
  return parsed as MetricsCurrentRow[];
}

export async function readMetricsForMappings(input: {
  readonly db: NodePgDatabase;
  readonly mappings: readonly import("../../domain/data-contracts").MappingIdentity[];
  readonly now?: Date;
}): Promise<readonly MetricReadValue[]> {
  const ids = input.mappings.map((mapping) => mapping.productId);
  const rows = await readCurrentMetricsRows(input.db, ids);
  return buildMetricsReadModel({ rows, mappings: input.mappings, now: input.now });
}

export interface MetricsWriteContext {
  readonly db: NodePgDatabase;
  readonly now?: Date;
  readonly runId: string;
}

/** Upserts every metric for one product atomically, preserving only same-identity last-valid data. */
export async function replaceMetricsForProduct(
  context: MetricsWriteContext,
  product: ProductId,
  inputs: readonly MetricObservation[],
): Promise<{ readonly written: number }> {
  const now = context.now ?? new Date();
  const observations = inputs.map((input) => parseMetricObservation(input, now));
  if (
    observations.some((input) => !input || input.productId !== product) ||
    new Set<string>(observations.map((input) => `${input?.source}:${input?.metric}`)).size !== observations.length ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.runId)
  ) throw new Error("Invalid metrics write plan.");

  const valid = observations as MetricObservation[];
  await context.db.transaction(async (tx) => {
    const previousRows = await tx.select().from(metricsCurrent).where(eq(metricsCurrent.productId, product));
    const previous = new Map<string, (typeof previousRows)[number]>(
      previousRows.map((row) => [`${row.source}:${row.metric}`, row]),
    );
    for (const observation of valid) {
      const key = `${observation.source}:${observation.metric}`;
      const old = previous.get(key);
      const sameIdentity = Boolean(old && old.sourceEntityId === observation.sourceEntityId &&
        old.sourceIdentity === observation.sourceIdentity);
      const isValid = observation.status === "ok" && observation.value !== null && observation.observedAt !== null;
      const current = {
        productId: observation.productId,
        source: observation.source,
        metric: observation.metric,
        sourceEntityId: observation.sourceEntityId,
        sourceIdentity: observation.sourceIdentity,
        sourceUrl: observation.sourceUrl,
        lastAttemptAt: new Date(observation.fetchedAt),
        lastStatus: observation.status,
        lastReason: observation.reason,
        validValue: isValid ? observation.value : sameIdentity ? old?.validValue ?? null : null,
        validObservedAt: isValid ? new Date(observation.observedAt!) : sameIdentity ? old?.validObservedAt ?? null : null,
        validFetchedAt: isValid ? new Date(observation.fetchedAt) : sameIdentity ? old?.validFetchedAt ?? null : null,
        validPeriodStart: isValid ? observation.periodStart : sameIdentity ? old?.validPeriodStart ?? null : null,
        validPeriodEnd: isValid ? observation.periodEnd : sameIdentity ? old?.validPeriodEnd ?? null : null,
        validSeries: isValid ? observation.dailySeries : sameIdentity ? old?.validSeries ?? null : null,
        runId: context.runId,
        updatedAt: now,
      };
      await tx.insert(metricsCurrent).values(current).onConflictDoUpdate({
        target: [metricsCurrent.productId, metricsCurrent.source, metricsCurrent.metric],
        set: {
          sourceEntityId: current.sourceEntityId,
          sourceIdentity: current.sourceIdentity,
          sourceUrl: current.sourceUrl,
          lastAttemptAt: current.lastAttemptAt,
          lastStatus: current.lastStatus,
          lastReason: current.lastReason,
          validValue: current.validValue,
          validObservedAt: current.validObservedAt,
          validFetchedAt: current.validFetchedAt,
          validPeriodStart: current.validPeriodStart,
          validPeriodEnd: current.validPeriodEnd,
          validSeries: current.validSeries,
          runId: current.runId,
          updatedAt: current.updatedAt,
        },
      });
    }
  });
  return { written: valid.length };
}

export function createMetricsWriter(context: Omit<MetricsWriteContext, "runId" | "now">): MetricsWriter {
  return {
    async replaceForProduct(productId, metrics) {
      try {
        const observations: MetricObservation[] = metrics.map((metric) => ({
          productId: metric.productId,
          source: metric.source,
          metric: metric.metric,
          sourceEntityId: metric.sourceEntityId,
          sourceIdentity: metric.sourceIdentity,
          sourceUrl: metric.sourceUrl ?? (metric.source === "npm"
            ? `https://www.npmjs.com/package/${encodeURIComponent(metric.sourceIdentity)}`
            : `https://github.com/${metric.sourceIdentity}`),
          status: metric.lastStatus,
          reason: metric.lastReason ?? null,
          value: metric.lastStatus === "ok" ? metric.validValue : null,
          observedAt: metric.lastStatus === "ok" ? metric.validObservedAt : null,
          fetchedAt: metric.validFetchedAt ?? metric.lastAttemptAt,
          periodStart: metric.source === "npm" ? metric.periodStart ?? null : null,
          periodEnd: metric.source === "npm" ? metric.periodEnd ?? null : null,
          dailySeries: metric.source === "npm" && metric.lastStatus === "ok" ? metric.dailySeries ?? null : null,
        }));
        const result = await replaceMetricsForProduct({ ...context, runId: crypto.randomUUID() }, productId, observations);
        return { ok: true, value: result };
      } catch {
        return { ok: false, code: "metrics_unavailable" };
      }
    },
  };
}
