import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicRuntimeConfig } from "../src/server/config/public";
import { CONSENT_COOKIE_NAME, getConsentState, setConsentState } from "../src/features/measurement/consent-store";
import { analyticsEnvironment, initializeMeasurement } from "../src/features/measurement/posthog-client";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setupBrowserStubs() {
  const sessionValues = new Map<string, string>();
  const localValues = new Map<string, string>();
  const createStorage = (values: Map<string, string>) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  }) as Storage;
  const sessionStorage = createStorage(sessionValues);
  const localStorage = createStorage(localValues);
  const cookies = new Map<string, string>();
  const documentStub = {
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join("; "); },
    set cookie(assignment: string) {
      const [pair, ...attributes] = assignment.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) return;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (attributes.some((attribute) => attribute.trim().toLowerCase() === "max-age=0")) {
        cookies.delete(name);
      } else {
        cookies.set(name, value);
      }
    },
  } as Document;
  const windowStub = {
    location: { protocol: "http:", search: "", pathname: "/en/" },
    sessionStorage,
    localStorage,
  } as unknown as Window;

  Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub });
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
  return { sessionValues, localValues, cookieNames: () => [...cookies.keys()] };
}

function restoreGlobal(name: "window" | "document", descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

afterEach(() => {
  if (getConsentState() !== "denied") setConsentState("denied");
  restoreGlobal("window", originalWindow);
  restoreGlobal("document", originalDocument);
});

describe("PostHog consent generation", () => {
  it("registers the public deployment environment before child effects create events", () => {
    const config: PublicRuntimeConfig = {
      environment: "production",
      measurement: { enabled: true, key: "synthetic-public-key", host: "https://eu.example.invalid" },
    };
    void initializeMeasurement(config);
    expect(analyticsEnvironment()).toBe("production");
  });

  it("restarts lazy initialization when consent is granted again during import", async () => {
    const browser = setupBrowserStubs();
    const config: PublicRuntimeConfig = {
      environment: "development",
      measurement: { enabled: true, key: "synthetic-key", host: "https://eu.example.invalid" },
    };
    const firstLoad = deferred<typeof import("posthog-js")>();
    const initialized = deferred<void>();
    const instance = {
      reset: vi.fn(),
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
      capture: vi.fn(() => true),
    };
    const init = vi.fn((_key: string, options: {
      loaded: (loadedInstance: typeof instance) => void;
      advanced_disable_flags: boolean;
      cross_subdomain_cookie: boolean;
    }) => {
      options.loaded(instance);
      initialized.resolve();
    });
    const sdk = {
      default: {
        init,
        reset: vi.fn(),
        opt_in_capturing: vi.fn(),
        opt_out_capturing: vi.fn(),
        capture: vi.fn(() => true),
      },
    } as unknown as typeof import("posthog-js");
    const importer = vi.fn<() => Promise<typeof import("posthog-js")>>()
      .mockImplementationOnce(() => firstLoad.promise)
      .mockResolvedValueOnce(sdk);

    setConsentState("granted");
    const staleInitialization = initializeMeasurement(config, importer);
    expect(importer).toHaveBeenCalledTimes(1);

    setConsentState("denied");
    setConsentState("granted");
    await initializeMeasurement(config, importer);
    firstLoad.resolve(sdk);
    await staleInitialization;
    await initialized.promise;

    expect(importer).toHaveBeenCalledTimes(2);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0]?.[1].advanced_disable_flags).toBe(true);
    expect(init.mock.calls[0]?.[1].cross_subdomain_cookie).toBe(false);
    expect(instance.opt_in_capturing).toHaveBeenCalledTimes(1);

    for (const key of [
      "ph_pkgcompass_analytics_v1",
      "ph_pkgcompass_analytics_v1_session_registered_properties",
      "ph_pkgcompass_analytics_v1_window_id",
      "ph_pkgcompass_analytics_v1_primary_window_exists",
      "pkgcompass_campaign_v1",
      "pkgcompass_conversion_ids_v1",
    ]) browser.sessionValues.set(key, "synthetic");
    browser.localValues.set("ph_pkgcompass_analytics_v1_window_id", "synthetic");
    browser.localValues.set("ph_pkgcompass_analytics_v1_primary_window_exists", "synthetic");
    setConsentState("denied");

    expect([...browser.sessionValues.keys()]).toEqual([]);
    expect([...browser.localValues.keys()]).toEqual([]);
    expect(browser.cookieNames()).toEqual([CONSENT_COOKIE_NAME]);
  });
});
