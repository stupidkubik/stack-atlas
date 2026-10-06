import { sql } from "drizzle-orm";
import {
  check,
  date,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const metricsCurrent = pgTable("metrics_current", {
  productId: text("product_id").notNull(),
  source: text("source").notNull(),
  metric: text("metric").notNull(),
  sourceEntityId: text("source_entity_id").notNull(),
  sourceIdentity: text("source_identity").notNull(),
  sourceUrl: text("source_url").notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "date" }).notNull(),
  lastStatus: text("last_status").notNull(),
  lastReason: text("last_reason"),
  validValue: jsonb("valid_value").$type<number | string | null>(),
  validObservedAt: timestamp("valid_observed_at", { withTimezone: true, mode: "date" }),
  validFetchedAt: timestamp("valid_fetched_at", { withTimezone: true, mode: "date" }),
  validPeriodStart: date("valid_period_start", { mode: "string" }),
  validPeriodEnd: date("valid_period_end", { mode: "string" }),
  validSeries: jsonb("valid_series").$type<readonly { readonly day: string; readonly downloads: number }[] | null>(),
  runId: uuid("run_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.productId, table.source, table.metric] }),
  check("metrics_current_source_ck", sql`${table.source} IN ('npm', 'github')`),
  check("metrics_current_status_ck", sql`${table.lastStatus} IN ('ok', 'error', 'unknown', 'not_applicable')`),
  check("metrics_current_source_identity_ck", sql`length(${table.sourceIdentity}) > 0`),
  check("metrics_current_source_url_ck", sql`${table.sourceUrl} LIKE 'https://%'`),
  check("metrics_current_metric_source_ck", sql`(
    (${table.source} = 'npm' AND ${table.metric} = 'downloads_30d') OR
    (${table.source} = 'github' AND ${table.metric} IN ('stars', 'open_issues', 'license'))
  )`),
  check("metrics_current_valid_value_fields_ck", sql`(
    (${table.validValue} IS NULL AND ${table.validObservedAt} IS NULL AND ${table.validFetchedAt} IS NULL) OR
    (${table.validValue} IS NOT NULL AND ${table.validObservedAt} IS NOT NULL AND ${table.validFetchedAt} IS NOT NULL)
  )`),
  check("metrics_current_period_ck", sql`(
    (${table.source} = 'npm' AND (${table.validPeriodStart} IS NULL) = (${table.validPeriodEnd} IS NULL) AND
      (${table.validPeriodStart} IS NULL OR ${table.validPeriodStart} <= ${table.validPeriodEnd})) OR
    (${table.source} = 'github' AND ${table.validPeriodStart} IS NULL AND ${table.validPeriodEnd} IS NULL AND ${table.validSeries} IS NULL)
  )`),
  check("metrics_current_series_ck", sql`
    ${table.validSeries} IS NULL OR
    (${table.source} = 'npm' AND ${table.metric} = 'downloads_30d' AND jsonb_typeof(${table.validSeries}) = 'array')
  `),
  check("metrics_current_last_status_ck", sql`
    ${table.lastStatus} <> 'ok' OR
    (${table.validValue} IS NOT NULL AND ${table.validObservedAt} IS NOT NULL AND ${table.validFetchedAt} IS NOT NULL)
  `),
]);
