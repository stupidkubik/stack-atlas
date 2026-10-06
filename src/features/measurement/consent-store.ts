"use client";

import { parseConsentCookieValue } from "../../domain/leads";

export const CONSENT_COOKIE_NAME = "pkgcompass_consent_v1";
export const CONSENT_POLICY_VERSION = 1 as const;
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

type ConsentListener = () => void;

let currentState: "unknown" | "denied" | "granted" = "unknown";
let generation = 0;
const listeners = new Set<ConsentListener>();

export function getConsentState(): "unknown" | "denied" | "granted" {
  return currentState;
}

export function getConsentGeneration(): number {
  return generation;
}

export function subscribeConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hydrateConsentFromCookie(): void {
  if (typeof document === "undefined") return;
  const item = document.cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${CONSENT_COOKIE_NAME}=`));
  if (!item) return;
  try {
    const parsed = parseConsentCookieValue(JSON.parse(decodeURIComponent(item.slice(CONSENT_COOKIE_NAME.length + 1))));
    if (parsed) transitionConsent(parsed.state);
  } catch {
    // Invalid/stale cookies are treated as no choice and are not copied elsewhere.
  }
}

export function setConsentState(state: "denied" | "granted"): void {
  if (typeof document !== "undefined") {
    const value = encodeURIComponent(JSON.stringify({ state, policyVersion: CONSENT_POLICY_VERSION }));
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CONSENT_COOKIE_NAME}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }
  transitionConsent(state);
}

function transitionConsent(state: "denied" | "granted"): void {
  if (currentState === state) return;
  currentState = state;
  generation += 1;
  for (const listener of [...listeners]) listener();
}
