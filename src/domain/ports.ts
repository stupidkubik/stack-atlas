import type {
  PublishedCatalog,
} from "./catalog";
import type { AnalyticsEvent, LeadScenario } from "./measurement";
import type { CurrentMetric } from "./metrics";
import type { ProductId } from "./ids";
import type { UtcDateTime } from "./utc";

export type AdapterFailureCode =
  | "adapter_unavailable"
  | "cms_unavailable"
  | "metrics_unavailable"
  | "crm_unavailable"
  | "measurement_unavailable"
  | "invalid_input";

export type AdapterResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly code: AdapterFailureCode };

export interface ContentRepository {
  getPublishedCatalog(): Promise<AdapterResult<PublishedCatalog>>;
}

export interface MetricsReader {
  readCurrent(productIds: readonly ProductId[]): Promise<AdapterResult<readonly CurrentMetric[]>>;
}

export interface MetricsWriter {
  replaceForProduct(
    productId: ProductId,
    metrics: readonly CurrentMetric[],
  ): Promise<AdapterResult<{ readonly written: number }>>;
}

export interface CrmRequest {
  readonly email: string;
  readonly scenario: LeadScenario;
  readonly contactPermissionAt: UtcDateTime;
}

export interface CrmContacts {
  upsertRequest(request: CrmRequest): Promise<AdapterResult<{ readonly accepted: true }>>;
}

export interface Measurement {
  capture(event: unknown): Promise<AdapterResult<{ readonly captured: boolean }>>;
}

export type TypedMeasurement = Measurement & {
  capture(event: AnalyticsEvent): Promise<AdapterResult<{ readonly captured: boolean }>>;
};
