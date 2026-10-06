"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import type { PublicRuntimeConfig } from "../../server/config/public";
import { routeTypeForPath } from "./events";
import {
  getConsentState,
  hydrateConsentFromCookie,
  setConsentState,
  subscribeConsent,
} from "./consent-store";
import { initializeMeasurement, trackPageView } from "./posthog-client";

export function ConsentManager({ publicConfig }: { readonly publicConfig: PublicRuntimeConfig }) {
  const pathname = usePathname() ?? "/en/";
  const choice = useSyncExternalStore(subscribeConsent, getConsentState, () => "unknown");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    hydrateConsentFromCookie();
  }, []);

  useEffect(() => {
    if (choice === "granted") void initializeMeasurement(publicConfig);
  }, [choice, publicConfig]);

  const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
  useEffect(() => {
    const routeType = routeTypeForPath(normalizedPath);
    if (choice === "granted" && routeType) trackPageView(normalizedPath, routeType);
  }, [choice, normalizedPath]);

  const showPanel = choice === "unknown" || settingsOpen;
  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-4xl">
      {showPanel ? (
        <section aria-labelledby="privacy-settings-title" className="rounded-2xl border border-slate-300 bg-white p-5 shadow-xl sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <h2 id="privacy-settings-title" className="text-base font-semibold text-slate-950">
                {choice === "unknown" ? "Choose optional analytics" : "Privacy settings"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Analytics helps the project owner understand aggregate page and shortlist flows. The form works either way.
                {!publicConfig.measurement.enabled ? " Analytics is not enabled in this environment." : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <button
                type="button"
                onClick={() => { setConsentState("granted"); setSettingsOpen(false); }}
                className="min-h-11 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-800"
              >Accept analytics</button>
              <button
                type="button"
                onClick={() => { setConsentState("denied"); setSettingsOpen(false); }}
                className="min-h-11 rounded-full border border-slate-400 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-800"
              >Reject analytics</button>
              {choice !== "unknown" ? (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="min-h-11 rounded-full px-3 py-2.5 text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-800"
                >Close</button>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-lg hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-800"
          >Privacy settings</button>
        </div>
      )}
    </div>
  );
}
