"use client";

import type { CaptureResult, PostHogInterface } from "posthog-js";
import { createCatalogIdAllowlist, sanitizeAnalyticsEvent, type AnalyticsEvent, type EventRouteType } from "../../domain/measurement";
import { isComparisonId, isConversionId, isProductId, productId as toProductId, type ConversionId } from "../../domain/ids";
import type { LeadScenario } from "../../domain/leads";
import type { PublicRuntimeConfig } from "../../server/config/public";
import {
  createAnalyticsEvent,
  makeComparisonViewed,
  makeLeadAccepted,
  makeLeadFormViewed,
  makePageViewed,
  campaignKeyFromUtm,
  setCatalogEventAllowlist,
} from "./events";
import {
  getConsentGeneration,
  getConsentState,
  subscribeConsent,
} from "./consent-store";

const analyticsPersistenceName = "pkgcompass_analytics_v1";
const sdkConsentCookieName = "pkgcompass_posthog_consent_v1";
const campaignStorageKey = "pkgcompass_campaign_v1";
const conversionStorageKey = "pkgcompass_conversion_ids_v1";
const sdkPersistenceKeys = [
  `ph_${analyticsPersistenceName}`,
  `ph_${analyticsPersistenceName}_session_registered_properties`,
  `ph_${analyticsPersistenceName}_window_id`,
  `ph_${analyticsPersistenceName}_primary_window_exists`,
] as const;
type EventData = AnalyticsEvent;
type MeasurementEnvironment = "development" | "production";
type EventIntent = {
  readonly generation: number;
  readonly build: (environment: MeasurementEnvironment) => EventData | undefined;
};
type PostHogSdkModule = typeof import("posthog-js");
type PostHogSdkImporter = () => Promise<PostHogSdkModule>;
const importPostHogSdk: PostHogSdkImporter = () => import("posthog-js");
let posthog: PostHogInterface | undefined;
let sdkReady = false;
let initStarted = false;
let isActive = false;
let pendingEvents: EventIntent[] = [];
let lastPageKey: string | undefined;
let currentConfig: PublicRuntimeConfig | undefined;
let currentCatalogAllowlist = createCatalogIdAllowlist({ productIds: [], comparisonIds: [], categoryIds: [] });

function safeSessionStorage(): Storage | undefined {
  try { return window.sessionStorage; } catch { return undefined; }
}

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function configuredMeasurementEnvironment(config: PublicRuntimeConfig | undefined): MeasurementEnvironment | undefined {
  return config?.environment === "development" || config?.environment === "production"
    ? config.environment
    : undefined;
}

function readStoredCampaign(): "portfolio" | "demo" | undefined {
  if (getConsentState() !== "granted") return undefined;
  try {
    const value = safeSessionStorage()?.getItem(campaignStorageKey);
    return value === "portfolio" || value === "demo" ? value : undefined;
  } catch { return undefined; }
}

function currentCampaign(): "portfolio" | "demo" | undefined {
  if (getConsentState() !== "granted") return undefined;
  const stored = readStoredCampaign();
  if (stored) return stored;
  try {
    const params = new URLSearchParams(window.location.search);
    const source = params.getAll("utm_source");
    const medium = params.getAll("utm_medium");
    const campaign = params.getAll("utm_campaign");
    if (source.length !== 1 || medium.length !== 1 || campaign.length !== 1) return undefined;
    const key = campaignKeyFromUtm({ source: source[0], medium: medium[0], campaign: campaign[0] });
    if (key) safeSessionStorage()?.setItem(campaignStorageKey, key);
    return key;
  } catch { return undefined; }
}

function storedConversionIds(): Set<string> {
  if (getConsentState() !== "granted") return new Set();
  try {
    const raw = safeSessionStorage()?.getItem(conversionStorageKey);
    if (!raw) return new Set();
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter(isConversionId));
  } catch { return new Set(); }
}

function markConversionCaptured(id: ConversionId): void {
  if (getConsentState() !== "granted") return;
  try {
    const ids = storedConversionIds();
    ids.add(id);
    safeSessionStorage()?.setItem(conversionStorageKey, JSON.stringify([...ids].slice(-100)));
  } catch { /* Storage may be disabled; SDK eventId still provides server-side dedupe. */ }
}

function clearOptionalStorage(): void {
  for (const storage of [safeSessionStorage(), safeLocalStorage()]) {
    try {
      for (const key of sdkPersistenceKeys) storage?.removeItem(key);
      storage?.removeItem(campaignStorageKey);
      storage?.removeItem(conversionStorageKey);
    } catch { /* Browser storage may be unavailable. */ }
  }
  if (typeof document !== "undefined") {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${sdkConsentCookieName}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

function knownEventProperties(event: CaptureResult): Record<string, unknown> {
  const base = ["eventSchemaVersion", "environment", "routeType", "locale", "occurredAt", "eventId"];
  const additional: Record<string, string[]> = {
    page_viewed: ["entityId"],
    comparison_viewed: ["comparisonId"],
    official_resource_clicked: ["productId", "resourceType"],
    lead_form_viewed: ["entryPoint"],
    lead_accepted: ["conversionId", "scenario", "campaignKey"],
  };
  const props = event.properties as Record<string, unknown>;
  const keys = additional[event.event] ?? [];
  const candidate: Record<string, unknown> = { name: event.event };
  for (const key of [...base, ...keys]) {
    if (key in props) candidate[key] = props[key];
  }
  return candidate;
}

export function sanitizeBeforeSend(event: CaptureResult | null): CaptureResult | null {
  if (!event || getConsentState() !== "granted") return null;
  const configuredToken = currentConfig?.measurement.enabled ? currentConfig.measurement.key : undefined;
  if (!configuredToken) return null;
  const sanitized = sanitizeAnalyticsEvent(knownEventProperties(event), currentCatalogAllowlist);
  if (!sanitized) return null;
  const source = event.properties as Record<string, unknown>;
  if (source.token !== configuredToken || typeof source.distinct_id !== "string" || source.distinct_id.length === 0) return null;
  const properties: Record<string, unknown> = {
    ...sanitized,
    // PostHog 1.436.1 requires this transport property to survive before_send.
    // Accept only the configured public project key, never a caller-supplied value.
    token: configuredToken,
    distinct_id: source.distinct_id,
    $insert_id: sanitized.eventId,
  };
  delete properties.name;
  return { uuid: event.uuid, event: event.event, properties };
}

function captureNow(event: EventData): boolean {
  if (!posthog || !isActive || getConsentState() !== "granted" || !currentConfig?.measurement.enabled ||
    event.environment !== currentConfig.environment) return false;
  const safeEvent = sanitizeAnalyticsEvent(event, currentCatalogAllowlist);
  if (!safeEvent) return false;
  const { name, ...properties } = safeEvent;
  const captured = posthog.capture(name, properties);
  if (name === "lead_accepted" && captured) markConversionCaptured(safeEvent.conversionId);
  return Boolean(captured);
}

function flushPendingEvents(): void {
  if (!isActive || getConsentState() !== "granted" || !currentConfig?.measurement.enabled) return;
  const events = pendingEvents;
  pendingEvents = [];
  const generation = getConsentGeneration();
  const environment = configuredMeasurementEnvironment(currentConfig);
  if (!environment) return;
  for (const intent of events) {
    if (intent.generation !== generation) continue;
    const event = intent.build(environment);
    if (event) captureNow(event);
  }
}

function activate(instance: PostHogInterface): void {
  if (getConsentState() !== "granted") {
    instance.opt_out_capturing();
    instance.reset(true);
    clearOptionalStorage();
    return;
  }
  if (!isActive) {
    instance.reset();
    // The allowlisted before_send drops the SDK's default opt-in event.
    instance.opt_in_capturing();
    posthog = instance;
    isActive = true;
  }
  flushPendingEvents();
}

function onConsentChange(state: "unknown" | "denied" | "granted"): void {
  if (state !== "granted") {
    isActive = false;
    pendingEvents = [];
    lastPageKey = undefined;
    if (posthog) {
      posthog.opt_out_capturing();
      posthog.reset(true);
    }
    clearOptionalStorage();
  } else if (posthog && sdkReady) {
    activate(posthog);
  }
}

subscribeConsent(() => onConsentChange(getConsentState()));

export function setMeasurementCatalogAllowlist(input: {
  readonly productIds: readonly string[];
  readonly comparisonIds: readonly string[];
  readonly categoryIds: readonly string[];
}): void {
  currentCatalogAllowlist = createCatalogIdAllowlist(input);
  setCatalogEventAllowlist(currentCatalogAllowlist);
}

export async function initializeMeasurement(
  config: PublicRuntimeConfig,
  importer: PostHogSdkImporter = importPostHogSdk,
): Promise<void> {
  currentConfig = config;
  if (!config.measurement.enabled) {
    pendingEvents = [];
    return;
  }
  if (getConsentState() !== "granted" || typeof window === "undefined") return;
  currentCampaign();
  const generation = getConsentGeneration();
  if (posthog && sdkReady) {
    activate(posthog);
    return;
  }
  if (initStarted) return;
  initStarted = true;
  try {
    const sdk = await importer();
    if (getConsentState() !== "granted" || generation !== getConsentGeneration()) {
      initStarted = false;
      if (getConsentState() === "granted" && currentConfig) {
        void initializeMeasurement(currentConfig, importer);
      }
      return;
    }
    sdk.default.init(config.measurement.key, {
      api_host: config.measurement.host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_surveys_automatic_display: true,
      disable_web_experiments: true,
      advanced_disable_flags: true,
      advanced_disable_feature_flags: true,
      advanced_disable_feature_flags_on_first_load: true,
      disable_external_dependency_loading: true,
      save_campaign_params: false,
      save_referrer: false,
      property_denylist: ["$current_url", "$pathname", "$referrer", "$initial_referrer", "$initial_referring_domain", "$host"],
      persistence: "sessionStorage",
      persistence_name: analyticsPersistenceName,
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      opt_out_capturing_persistence_type: "cookie",
      consent_persistence_name: sdkConsentCookieName,
      request_batching: false,
      cross_subdomain_cookie: false,
      before_send: sanitizeBeforeSend,
      loaded: (instance) => {
        posthog = instance;
        sdkReady = true;
        initStarted = false;
        if (getConsentState() === "granted" && generation === getConsentGeneration()) {
          activate(instance);
        } else {
          instance.opt_out_capturing();
          instance.reset(true);
          clearOptionalStorage();
          if (getConsentState() === "granted" && currentConfig) {
            void initializeMeasurement(currentConfig, importer);
          }
        }
      },
    });
    posthog = sdk.default;
  } catch {
    initStarted = false;
    sdkReady = false;
    posthog = undefined;
  }
}

function capture(build: EventIntent["build"]): void {
  if (getConsentState() !== "granted") return;
  if (currentConfig && !currentConfig.measurement.enabled) return;
  const intent: EventIntent = { generation: getConsentGeneration(), build };
  const environment = configuredMeasurementEnvironment(currentConfig);
  if (!environment) {
    if (currentConfig && !currentConfig.measurement.enabled) return;
    if (pendingEvents.length < 20) pendingEvents.push(intent);
    return;
  }
  const event = build(environment);
  if (event && !captureNow(event) && getConsentState() === "granted" && pendingEvents.length < 20) {
    pendingEvents.push(intent);
  }
}

export function trackPageView(pathname: string, routeType: EventRouteType): void {
  if (getConsentState() !== "granted") return;
  const key = `${pathname}|${routeType}`;
  if (lastPageKey === key) return;
  lastPageKey = key;
  capture((environment) => makePageViewed(routeType, environment));
}

export function trackLeadFormViewed(entryPoint: "nav" | "comparison" | "product" | "home"): void {
  if (getConsentState() !== "granted") return;
  capture((environment) => makeLeadFormViewed(entryPoint, environment));
}

export function trackLeadAccepted(id: ConversionId, scenario: LeadScenario): void {
  if (getConsentState() !== "granted" || storedConversionIds().has(id)) return;
  capture((environment) => makeLeadAccepted(id, scenario, currentCampaign(), environment));
}

export function trackComparisonViewed(comparisonId: string): void {
  if (getConsentState() !== "granted" || !isComparisonId(comparisonId)) return;
  capture((environment) => makeComparisonViewed(comparisonId, environment));
}

export function trackOfficialResourceClicked(productId: string, resourceType: "docs" | "website"): void {
  if (getConsentState() !== "granted" || !isProductId(productId)) return;
  capture((environment) => createAnalyticsEvent({ name: "official_resource_clicked", routeType: "product", productId: toProductId(productId), resourceType }, environment));
}

export function analyticsEnvironment(): "development" | "production" | undefined {
  return configuredMeasurementEnvironment(currentConfig);
}
