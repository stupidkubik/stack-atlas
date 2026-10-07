import {
  createCatalogIdAllowlist,
  sanitizeAnalyticsEvent,
  type AnalyticsEvent,
  type CatalogIdAllowlist,
  type EventRouteType,
} from "../../domain/measurement";
import { comparisonId as toComparisonId, eventId, isComparisonId, type ConversionId, type EventId } from "../../domain/ids";
import type { LeadScenario } from "../../domain/leads";
import { utcDateTime } from "../../domain/utc";

let catalogAllowlist = createCatalogIdAllowlist({ productIds: [], comparisonIds: [], categoryIds: [] });
const campaignMappings = new Map<string, "portfolio" | "demo">([
  ["portfolio|referral|pkgcompass", "portfolio"],
  ["demo|referral|pkgcompass", "demo"],
]);

export function setCatalogEventAllowlist(allowlist: CatalogIdAllowlist): void {
  catalogAllowlist = createCatalogIdAllowlist({
    productIds: [...allowlist.productIds],
    comparisonIds: [...allowlist.comparisonIds],
    categoryIds: [...allowlist.categoryIds],
  });
}

export function routeTypeForPath(pathname: string): EventRouteType | undefined {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  if (path === "/en/") return "home";
  if (path === "/en/request-shortlist/") return "lead_form";
  if (path === "/en/privacy/") return "privacy";
  if (path === "/en/methodology/ai-readiness/") return "methodology";
  if (/^\/en\/compare\/[a-z0-9-]+-vs-[a-z0-9-]+\/$/.test(path)) return "comparison";
  if (/^\/en\/tools\/[a-z0-9-]+\/$/.test(path)) return "product";
  if (/^\/en\/categories\/[a-z0-9-]+\/$/.test(path)) return "catalog";
  return undefined;
}

export function campaignKeyFromUtm(input: {
  readonly source: string;
  readonly medium: string;
  readonly campaign: string;
}): "portfolio" | "demo" | undefined {
  const normalize = (value: string) => value.trim().toLowerCase();
  const key = `${normalize(input.source)}|${normalize(input.medium)}|${normalize(input.campaign)}`;
  return campaignMappings.get(key);
}

type EventPropertiesOf<Event> = Event extends AnalyticsEvent
  ? Omit<Event, "eventId" | "occurredAt" | "eventSchemaVersion" | "environment" | "locale">
  : never;
type EventProperties = EventPropertiesOf<AnalyticsEvent>;

export function createAnalyticsEvent(
  properties: EventProperties,
  environment: "development" | "production",
  now = new Date(),
): AnalyticsEvent | undefined {
  const id: EventId = properties.name === "lead_accepted"
    ? eventId(properties.conversionId)
    : eventId(crypto.randomUUID());
  return sanitizeAnalyticsEvent({
    ...properties,
    eventSchemaVersion: 1,
    environment,
    routeType: properties.routeType,
    locale: "en",
    occurredAt: utcDateTime(now.toISOString()),
    eventId: id,
  }, catalogAllowlist);
}

export function makePageViewed(
  routeType: EventRouteType,
  environment: "development" | "production",
): AnalyticsEvent | undefined {
  return createAnalyticsEvent({ name: "page_viewed", routeType }, environment);
}

export function makeComparisonViewed(
  id: string,
  environment: "development" | "production",
): AnalyticsEvent | undefined {
  if (!isComparisonId(id)) return undefined;
  return createAnalyticsEvent({ name: "comparison_viewed", routeType: "comparison", comparisonId: toComparisonId(id) }, environment);
}

export function makeLeadFormViewed(
  entryPoint: "nav" | "comparison" | "product" | "home",
  environment: "development" | "production",
): AnalyticsEvent | undefined {
  return createAnalyticsEvent({ name: "lead_form_viewed", routeType: "lead_form", entryPoint }, environment);
}

export function makeLeadAccepted(
  id: ConversionId,
  scenario: LeadScenario,
  campaignKey: "portfolio" | "demo" | undefined,
  environment: "development" | "production",
): AnalyticsEvent | undefined {
  return createAnalyticsEvent({
    name: "lead_accepted",
    routeType: "lead_form",
    conversionId: id,
    scenario,
    ...(campaignKey ? { campaignKey } : {}),
  }, environment);
}
