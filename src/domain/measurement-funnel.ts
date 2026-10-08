import type { AnalyticsEvent, EventEnvironment } from "./measurement";

/** Aggregate-only output; anonymous identifiers remain in the caller's memory. */
export interface FunnelObservation {
  readonly visitorId: string;
  readonly event: AnalyticsEvent;
}

const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;

/** Reference calculation for validating the saved PostHog report on synthetic data. */
export function summarizeComparisonFunnel(observations: readonly FunnelObservation[], environment: EventEnvironment) {
  const visitors = new Map<string, AnalyticsEvent[]>();
  const conversions = new Set<string>();
  const seenEvents = new Set<string>();
  for (const observation of observations) {
    const { visitorId, event } = observation;
    if (event.environment !== environment || !visitorId || seenEvents.has(event.eventId)) continue;
    seenEvents.add(event.eventId);
    if (event.name === "lead_accepted") conversions.add(event.conversionId);
    const events = visitors.get(visitorId) ?? [];
    events.push(event);
    visitors.set(visitorId, events);
  }

  let comparisonVisitors = 0;
  let convertedVisitors = 0;
  for (const events of visitors.values()) {
    const comparisons = events.filter((event) => event.name === "comparison_viewed");
    if (!comparisons.length) continue;
    comparisonVisitors += 1;
    const forms = events.filter((event) => event.name === "lead_form_viewed");
    const accepted = events.filter((event) => event.name === "lead_accepted");
    const qualifies = comparisons.some((comparison) => {
      const startedAt = Date.parse(comparison.occurredAt);
      return forms.some((form) => {
        const formAt = Date.parse(form.occurredAt);
        return formAt >= startedAt && accepted.some((lead) => {
          const acceptedAt = Date.parse(lead.occurredAt);
          return acceptedAt >= formAt && acceptedAt - startedAt <= sevenDaysMs;
        });
      });
    });
    if (qualifies) convertedVisitors += 1;
  }

  return {
    comparisonVisitors,
    convertedVisitors,
    conversionRate: comparisonVisitors ? convertedVisitors / comparisonVisitors : 0,
    uniqueConversions: conversions.size,
  };
}

/** Development-only HogQL report. Repeated deliveries cannot inflate either count.
 * Report window is intentionally all available development data for the smoke;
 * the seven-day restriction applies to each journey, not to ingestion age.
 */
export const developmentComparisonFunnelQuery = `WITH comparisons AS (
  SELECT distinct_id, toDateTime64(properties.occurredAt, 3, 'UTC') AS compared_at
  FROM events
  WHERE event = 'comparison_viewed' AND properties.environment = 'development'
), forms AS (
  SELECT distinct_id, toDateTime64(properties.occurredAt, 3, 'UTC') AS form_at
  FROM events
  WHERE event = 'lead_form_viewed' AND properties.environment = 'development'
), accepted AS (
  SELECT distinct_id, toDateTime64(properties.occurredAt, 3, 'UTC') AS accepted_at
  FROM events
  WHERE event = 'lead_accepted' AND properties.environment = 'development'
), qualified AS (
  SELECT DISTINCT c.distinct_id AS visitor_id
  FROM comparisons AS c
  JOIN forms AS f ON c.distinct_id = f.distinct_id
  JOIN accepted AS a ON c.distinct_id = a.distinct_id
  WHERE f.form_at >= c.compared_at AND a.accepted_at >= f.form_at
    AND a.accepted_at <= c.compared_at + INTERVAL 7 DAY
)
SELECT
  (SELECT count(DISTINCT distinct_id) FROM comparisons) AS comparison_visitors,
  (SELECT count(DISTINCT visitor_id) FROM qualified) AS converted_visitors,
  if(comparison_visitors = 0, 0, converted_visitors / comparison_visitors) AS conversion_rate,
  (SELECT count(DISTINCT properties.conversionId) FROM events
    WHERE event = 'lead_accepted' AND properties.environment = 'development') AS unique_conversions`;
