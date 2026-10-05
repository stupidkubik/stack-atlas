import "server-only";

import type { CrmContacts, ContentRepository, Measurement, MetricsReader, MetricsWriter } from "../../domain/ports";
import type { AnalyticsEvent, CatalogIdAllowlist } from "../../domain/measurement";
import { sanitizeAnalyticsEvent } from "../../domain/measurement";
import type { AdapterResult } from "../../domain/ports";
import type { CurrentMetric } from "../../domain/metrics";
import type { ProductId } from "../../domain/ids";
import { utcDateTime } from "../../domain/utc";
import { fixtureSnapshot } from "../fixtures/catalog";
import { syntheticGitHubRepositoryResponse, syntheticNpmFullPeriodResponse, syntheticNpmIncompletePeriodResponse } from "../fixtures/api-responses";
import { toPublishedCatalog } from "../../domain/catalog";

const observedAt = utcDateTime("2026-10-04T12:00:00.000Z");
const attemptedAt = utcDateTime("2026-10-05T12:00:00.000Z");

const metricFixtures: readonly CurrentMetric[] = [
  {
    productId: fixtureSnapshot.products[0].id,
    source: "npm",
    metric: "downloads_30d",
    sourceEntityId: fixtureSnapshot.packages[0].id,
    sourceIdentity: syntheticNpmFullPeriodResponse.packageName,
    lastAttemptAt: attemptedAt,
    lastStatus: "ok",
    validValue: syntheticNpmFullPeriodResponse.downloads.reduce((sum, item) => sum + item.count, 0),
    validObservedAt: observedAt,
    validFetchedAt: attemptedAt,
    periodStart: syntheticNpmFullPeriodResponse.start,
    periodEnd: syntheticNpmFullPeriodResponse.end,
    dailySeries: syntheticNpmFullPeriodResponse.downloads.map(({ day, count }) => ({ day, downloads: count })),
  },
  {
    productId: fixtureSnapshot.products[1].id,
    source: "npm",
    metric: "downloads_30d",
    sourceEntityId: fixtureSnapshot.packages[2].id,
    sourceIdentity: syntheticNpmIncompletePeriodResponse.packageName,
    lastAttemptAt: attemptedAt,
    lastStatus: "unknown",
    validValue: null,
    validObservedAt: null,
    validFetchedAt: null,
    periodStart: syntheticNpmIncompletePeriodResponse.start,
    periodEnd: syntheticNpmIncompletePeriodResponse.end,
  },
  {
    productId: fixtureSnapshot.products[1].id,
    source: "github",
    metric: "stars",
    sourceEntityId: fixtureSnapshot.repositories[1].id,
    sourceIdentity: syntheticGitHubRepositoryResponse.full_name,
    lastAttemptAt: attemptedAt,
    lastStatus: "ok",
    validValue: syntheticGitHubRepositoryResponse.stargazers_count,
    validObservedAt: observedAt,
    validFetchedAt: attemptedAt,
  },
];

export interface FixtureAdapters {
  readonly content: ContentRepository;
  readonly metricsReader: MetricsReader;
  readonly metricsWriter: MetricsWriter;
  readonly crm: CrmContacts;
  readonly measurement: Measurement;
  readonly measurementSnapshot: () => readonly AnalyticsEvent[];
  readonly acceptedRequestCount: () => number;
}

export function createFixtureAdapters(allowlist: CatalogIdAllowlist): FixtureAdapters {
  const capturedEvents: AnalyticsEvent[] = [];
  let acceptedRequestCount = 0;

  const content: ContentRepository = {
    async getPublishedCatalog() {
      return { ok: true, value: toPublishedCatalog(fixtureSnapshot) };
    },
  };
  const metricsReader: MetricsReader = {
    async readCurrent(productIds) {
      return { ok: true, value: metricFixtures.filter((metric) => productIds.includes(metric.productId)) };
    },
  };
  const metricsWriter: MetricsWriter = {
    async replaceForProduct(_productId, metrics) {
      return { ok: true, value: { written: metrics.length } };
    },
  };
  const crm: CrmContacts = {
    async upsertRequest(request) {
      // Intentionally retain only a count; the opaque email input is neither stored nor logged.
      void request;
      acceptedRequestCount += 1;
      return { ok: true, value: { accepted: true } };
    },
  };
  const measurement: Measurement = {
    async capture(event) {
      const safeEvent = sanitizeAnalyticsEvent(event, allowlist);
      if (!safeEvent) return { ok: false, code: "invalid_input" };
      capturedEvents.push(safeEvent);
      return { ok: true, value: { captured: true } };
    },
  };

  return {
    content,
    metricsReader,
    metricsWriter,
    crm,
    measurement,
    measurementSnapshot: () => capturedEvents.map((event) => ({ ...event })),
    acceptedRequestCount: () => acceptedRequestCount,
  };
}

export interface AdapterTargets {
  readonly content: { readonly mode: "fixture" | "live" };
  readonly metricsReader: { readonly mode: "fixture" | "live" };
  readonly metricsWriter: { readonly mode: "fixture" | "live" };
  readonly crm: { readonly mode: "fixture" | "live" };
  readonly measurement: { readonly mode: "fixture" | "live" };
}

export interface AdapterPorts {
  readonly content: ContentRepository;
  readonly metricsReader: MetricsReader;
  readonly metricsWriter: MetricsWriter;
  readonly crm: CrmContacts;
  readonly measurement: Measurement;
}

function unavailable<Value>(): AdapterResult<Value> {
  return { ok: false, code: "adapter_unavailable" };
}

/** Live selection is explicit and never falls through to local fake data. */
export function createAdaptersForTargets(
  targets: AdapterTargets,
  allowlist: CatalogIdAllowlist,
): AdapterPorts {
  const fixture = createFixtureAdapters(allowlist);
  return {
    content: targets.content.mode === "fixture"
      ? fixture.content
      : { async getPublishedCatalog() { return unavailable(); } },
    metricsReader: targets.metricsReader.mode === "fixture"
      ? fixture.metricsReader
      : { async readCurrent(productIds) { void productIds; return unavailable(); } },
    metricsWriter: targets.metricsWriter.mode === "fixture"
      ? fixture.metricsWriter
      : { async replaceForProduct(productId: ProductId, metrics) { void productId; void metrics; return unavailable(); } },
    crm: targets.crm.mode === "fixture"
      ? fixture.crm
      : { async upsertRequest(request) { void request; return unavailable(); } },
    measurement: targets.measurement.mode === "fixture"
      ? fixture.measurement
      : { async capture(event) { void event; return unavailable(); } },
  };
}
