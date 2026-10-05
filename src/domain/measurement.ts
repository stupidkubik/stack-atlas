import {
  categoryId,
  comparisonId,
  conversionId,
  eventId,
  isCategoryId,
  isComparisonId,
  isConversionId,
  isEventId,
  isProductId,
  productId,
  type CategoryId,
  type ComparisonId,
  type ConversionId,
  type EventId,
  type ProductId,
} from "./ids";
import { denseDataArray, plainDataRecord } from "./safe-objects";
import { isUtcDateTime } from "./utc";
import type { UtcDateTime } from "./utc";

export type EventRouteType =
  | "home"
  | "catalog"
  | "product"
  | "comparison"
  | "methodology"
  | "lead_form"
  | "privacy";
export type LeadScenario = "marketing_site" | "editorial_site" | "commerce_content";
export type CampaignKey = "portfolio" | "demo";
export type EventEnvironment = "development" | "production";

interface EventBase {
  readonly eventSchemaVersion: 1;
  readonly environment: EventEnvironment;
  readonly routeType: EventRouteType;
  readonly locale: "en";
  readonly occurredAt: UtcDateTime;
  readonly eventId: EventId;
}

export type AnalyticsEvent =
  | (EventBase & {
      readonly name: "page_viewed";
      readonly entityId?: ProductId | ComparisonId | CategoryId;
    })
  | (EventBase & {
      readonly name: "comparison_viewed";
      readonly routeType: "comparison";
      readonly comparisonId: ComparisonId;
    })
  | (EventBase & {
      readonly name: "official_resource_clicked";
      readonly routeType: "product";
      readonly productId: ProductId;
      readonly resourceType: "docs" | "website";
    })
  | (EventBase & {
      readonly name: "lead_form_viewed";
      readonly routeType: "lead_form";
      readonly entryPoint: "nav" | "comparison" | "product" | "home";
    })
  | (EventBase & {
      readonly name: "lead_accepted";
      readonly routeType: "lead_form";
      readonly conversionId: ConversionId;
      readonly scenario: LeadScenario;
      readonly campaignKey?: CampaignKey;
    });

const baseKeys = [
  "eventSchemaVersion",
  "environment",
  "routeType",
  "locale",
  "occurredAt",
  "eventId",
  "name",
] as const;

const values = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && list.includes(value as T);

const routes = [
  "home",
  "catalog",
  "product",
  "comparison",
  "methodology",
  "lead_form",
  "privacy",
] as const;
const scenarios = ["marketing_site", "editorial_site", "commerce_content"] as const;
const entryPoints = ["nav", "comparison", "product", "home"] as const;
const campaignKeys = ["portfolio", "demo"] as const;

export interface CatalogIdAllowlistInput {
  readonly productIds: readonly string[];
  readonly comparisonIds: readonly string[];
  readonly categoryIds: readonly string[];
}

export interface CatalogIdAllowlist {
  readonly kind: "catalog-id-allowlist";
  readonly productIds: readonly ProductId[];
  readonly comparisonIds: readonly ComparisonId[];
  readonly categoryIds: readonly CategoryId[];
}

export function createCatalogIdAllowlist(input: CatalogIdAllowlistInput): CatalogIdAllowlist {
  const source = plainDataRecord(input);
  const products = source && denseDataArray(source.productIds);
  const comparisons = source && denseDataArray(source.comparisonIds);
  const categories = source && denseDataArray(source.categoryIds);
  if (
    !products || !products.every(isProductId) ||
    !comparisons || !comparisons.every(isComparisonId) ||
    !categories || !categories.every(isCategoryId)
  ) throw new Error("Invalid catalog ID allowlist.");

  return Object.freeze({
    kind: "catalog-id-allowlist" as const,
    productIds: Object.freeze(products.map((id) => productId(id))),
    comparisonIds: Object.freeze(comparisons.map((id) => comparisonId(id))),
    categoryIds: Object.freeze(categories.map((id) => categoryId(id))),
  });
}

function hasOnlyKeys(event: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(event).every((key) => allowed.includes(key));
}

function projectBase(event: Record<string, unknown>): EventBase | undefined {
  if (
    event.eventSchemaVersion !== 1 ||
    !values(["development", "production"] as const, event.environment) ||
    !values(routes, event.routeType) ||
    event.locale !== "en" ||
    !isUtcDateTime(event.occurredAt) ||
    !isEventId(event.eventId)
  ) return undefined;
  return {
    eventSchemaVersion: 1,
    environment: event.environment,
    routeType: event.routeType,
    locale: "en",
    occurredAt: event.occurredAt,
    eventId: eventId(event.eventId),
  };
}

export function sanitizeAnalyticsEvent(
  value: unknown,
  allowlist: CatalogIdAllowlist,
): AnalyticsEvent | undefined {
  const event = plainDataRecord(value);
  const catalogIds = plainDataRecord(allowlist);
  const productIds = catalogIds && denseDataArray(catalogIds.productIds);
  const comparisonIds = catalogIds && denseDataArray(catalogIds.comparisonIds);
  const categoryIds = catalogIds && denseDataArray(catalogIds.categoryIds);
  if (
    !event || !catalogIds || catalogIds.kind !== "catalog-id-allowlist" || typeof event.name !== "string" ||
    !productIds || !productIds.every(isProductId) ||
    !comparisonIds || !comparisonIds.every(isComparisonId) ||
    !categoryIds || !categoryIds.every(isCategoryId)
  ) return undefined;
  const base = projectBase(event);
  if (!base) return undefined;

  switch (event.name) {
    case "page_viewed": {
      if (!hasOnlyKeys(event, [...baseKeys, "entityId"])) return undefined;
      let entityId: ProductId | ComparisonId | CategoryId | undefined;
      if (event.entityId !== undefined) {
        if (
          event.routeType === "product" &&
          isProductId(event.entityId) &&
          productIds.includes(event.entityId)
        ) {
          entityId = productId(event.entityId);
        } else if (
          event.routeType === "comparison" &&
          isComparisonId(event.entityId) &&
          comparisonIds.includes(event.entityId)
        ) {
          entityId = comparisonId(event.entityId);
        } else if (
          event.routeType === "catalog" &&
          isCategoryId(event.entityId) &&
          categoryIds.includes(event.entityId)
        ) {
          entityId = categoryId(event.entityId);
        } else return undefined;
      }
      return { ...base, name: "page_viewed", ...(entityId ? { entityId } : {}) };
    }
    case "comparison_viewed": {
      if (
        !hasOnlyKeys(event, [...baseKeys, "comparisonId"]) ||
        event.routeType !== "comparison" ||
        !isComparisonId(event.comparisonId) ||
        !comparisonIds.includes(event.comparisonId)
      ) {
        return undefined;
      }
      return { ...base, name: "comparison_viewed", routeType: "comparison", comparisonId: comparisonId(event.comparisonId) };
    }
    case "official_resource_clicked": {
      if (
        !hasOnlyKeys(event, [...baseKeys, "productId", "resourceType"]) ||
        event.routeType !== "product" ||
        !isProductId(event.productId) ||
        !productIds.includes(event.productId) ||
        !values(["docs", "website"] as const, event.resourceType)
      ) {
        return undefined;
      }
      return { ...base, name: "official_resource_clicked", routeType: "product", productId: productId(event.productId), resourceType: event.resourceType };
    }
    case "lead_form_viewed": {
      if (
        !hasOnlyKeys(event, [...baseKeys, "entryPoint"]) ||
        event.routeType !== "lead_form" ||
        !values(entryPoints, event.entryPoint)
      ) {
        return undefined;
      }
      return { ...base, name: "lead_form_viewed", routeType: "lead_form", entryPoint: event.entryPoint };
    }
    case "lead_accepted": {
      if (
        !hasOnlyKeys(event, [...baseKeys, "conversionId", "scenario", "campaignKey"]) ||
        event.routeType !== "lead_form" ||
        !isConversionId(event.conversionId) ||
        (base.eventId as string) !== event.conversionId ||
        !values(scenarios, event.scenario) ||
        (event.campaignKey !== undefined && !values(campaignKeys, event.campaignKey))
      ) {
        return undefined;
      }
      return {
        ...base,
        name: "lead_accepted",
        routeType: "lead_form",
        conversionId: conversionId(event.conversionId),
        scenario: event.scenario,
        ...(event.campaignKey !== undefined ? { campaignKey: event.campaignKey } : {}),
      };
    }
    default:
      return undefined;
  }
}
