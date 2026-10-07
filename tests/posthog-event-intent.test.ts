import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult, PostHogInterface } from "posthog-js";
import type { PublicRuntimeConfig } from "../src/server/config/public";
import { setConsentState } from "../src/features/measurement/consent-store";
import { analyticsEnvironment, initializeMeasurement, trackLeadFormViewed } from "../src/features/measurement/posthog-client";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

function installBrowserStubs(): void {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
  const cookies = new Map<string, string>();
  const documentStub = {
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join("; "); },
    set cookie(assignment: string) {
      const [pair, ...attributes] = assignment.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) return;
      const name = pair.slice(0, separator);
      if (attributes.some((attribute) => attribute.trim().toLowerCase() === "max-age=0")) cookies.delete(name);
      else cookies.set(name, pair.slice(separator + 1));
    },
  } as Document;
  const windowStub = {
    location: { protocol: "http:", search: "", pathname: "/en/request-shortlist/" },
    sessionStorage: storage,
    localStorage: storage,
  } as unknown as Window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
}

afterEach(() => {
  setConsentState("denied");
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("measurement event environment intents", () => {
  it("keeps a granted direct-load form intent until production config can label it", async () => {
    installBrowserStubs();
    setConsentState("granted");

    trackLeadFormViewed("comparison");
    expect(analyticsEnvironment()).toBeUndefined();

    const config: PublicRuntimeConfig = {
      environment: "production",
      measurement: { enabled: true, key: "synthetic-public-key", host: "https://eu.example.invalid" },
    };
    let initOptions: {
      loaded: (loadedInstance: PostHogInterface) => void;
      before_send: (event: CaptureResult | null) => CaptureResult | null;
      advanced_disable_flags: boolean;
      cross_subdomain_cookie: boolean;
    } | undefined;
    const safeCapturedEvents: CaptureResult[] = [];
    const counts = { imports: 0, inits: 0, loaded: 0, captures: 0, beforeSend: 0 };
    const capture = vi.fn((eventName: string, properties: Record<string, unknown>) => {
      counts.captures += 1;
      counts.beforeSend += 1;
      const safeEvent = initOptions?.before_send({
        uuid: "fixture-sdk-uuid",
        event: eventName,
        properties: { ...properties, token: config.measurement.enabled ? config.measurement.key : "", distinct_id: "fixture-anonymous-id" },
      } as CaptureResult);
      if (!safeEvent) return false;
      safeCapturedEvents.push(safeEvent);
      return true;
    });
    const instance = {
      reset: vi.fn(),
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
      capture,
    } as unknown as PostHogInterface;
    const sdk = {
      default: {
        init: (_key: string, options: NonNullable<typeof initOptions>) => {
          counts.inits += 1;
          initOptions = options;
          counts.loaded += 1;
          options.loaded(instance);
        },
        reset: vi.fn(),
        opt_in_capturing: vi.fn(),
        opt_out_capturing: vi.fn(),
        capture,
      },
    } as unknown as typeof import("posthog-js");
    const importer = vi.fn(async () => {
      counts.imports += 1;
      return sdk;
    });

    await initializeMeasurement(config, importer);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]?.[0]).toBe("lead_form_viewed");
    expect(capture.mock.calls[0]?.[1]).toMatchObject({ environment: "production", entryPoint: "comparison" });
    expect(counts).toEqual({ imports: 1, inits: 1, loaded: 1, captures: 1, beforeSend: 1 });
    expect(initOptions?.advanced_disable_flags).toBe(true);
    expect(initOptions?.cross_subdomain_cookie).toBe(false);
    expect(safeCapturedEvents[0]?.event).toBe("lead_form_viewed");
    expect(safeCapturedEvents[0]?.properties).toMatchObject({
      environment: "production",
      entryPoint: "comparison",
      token: "synthetic-public-key",
      distinct_id: "fixture-anonymous-id",
    });
    expect(safeCapturedEvents[0]?.properties).not.toHaveProperty("$current_url");
  });
});
