"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LEAD_SCENARIOS, type LeadScenario } from "../../domain/leads";
import { trackLeadAccepted, trackLeadFormViewed } from "../measurement/posthog-client";
import { submitLeadForm } from "./api-client";

export type ShortlistEntryPoint = "nav" | "comparison" | "product" | "home";

type FormState = "idle" | "submitting" | "accepted" | "retryable_error" | "validation_error" | "rate_limited";

const scenarioLabels: Record<LeadScenario, string> = {
  marketing_site: "Marketing website",
  editorial_site: "Editorial or publication website",
  commerce_content: "Commerce content website",
};

const inputClass = "mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 shadow-sm outline-none transition focus:border-sky-700 focus:ring-2 focus:ring-sky-700/20";

export function ShortlistForm({ entryPoint }: { readonly entryPoint: ShortlistEntryPoint }) {
  const [email, setEmail] = useState("");
  const [scenario, setScenario] = useState<LeadScenario | "">("");
  const [permission, setPermission] = useState(false);
  const [state, setState] = useState<FormState>("idle");
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    trackLeadFormViewed(entryPoint);
  }, [entryPoint]);

  function clearRetryIdentity() {
    requestId.current = null;
    if (state !== "submitting") setState("idle");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) {
      setState("validation_error");
      return;
    }
    if (!scenario || !permission) {
      setState("validation_error");
      return;
    }

    requestId.current ??= crypto.randomUUID();
    setState("submitting");
    const response = await submitLeadForm({
      requestId: requestId.current,
      email: email.trim().toLowerCase(),
      scenario,
    });

    if (response.kind === "retryable_error") {
      setState("retryable_error");
      return;
    }
    switch (response.result.status) {
      case "accepted":
        if (response.result.analyticsEligible) {
          trackLeadAccepted(response.result.conversionId, scenario);
        }
        setState("accepted");
        return;
      case "rate_limited":
        setState("rate_limited");
        return;
      case "invalid":
        requestId.current = null;
        setState("validation_error");
        return;
      case "conflict":
      case "unavailable":
        setState("retryable_error");
        return;
    }
  }

  const busy = state === "submitting";
  const accepted = state === "accepted";
  const errorMessage = state === "retryable_error"
    ? "We could not confirm your request. Please retry."
    : state === "rate_limited"
      ? "Too many attempts were made. Please wait a little and try again."
      : state === "validation_error"
        ? "Check the highlighted fields and try again."
        : "";

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9" data-entry-point={entryPoint}>
      {accepted ? (
        <div role="status" aria-live="polite" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
          <h2 className="text-xl font-semibold">Your request is saved.</h2>
          <p className="mt-2 leading-7">The project owner may contact you about this request.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-6">
            <div>
              <label htmlFor="shortlist-email" className="block text-sm font-semibold text-slate-900">Email address</label>
              <input
                id="shortlist-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => { setEmail(event.target.value); clearRetryIdentity(); }}
                aria-describedby={state === "validation_error" ? "shortlist-error" : "shortlist-email-help"}
                aria-invalid={state === "validation_error" ? true : undefined}
                className={inputClass}
              />
              <p id="shortlist-email-help" className="mt-2 text-sm leading-6 text-slate-600">We use this address only to reply about your request.</p>
            </div>

            <div>
              <label htmlFor="shortlist-scenario" className="block text-sm font-semibold text-slate-900">What kind of site are you choosing for?</label>
              <select
                id="shortlist-scenario"
                name="scenario"
                required
                value={scenario}
                onChange={(event) => { setScenario(event.target.value as LeadScenario | ""); clearRetryIdentity(); }}
                aria-invalid={state === "validation_error" && !scenario ? true : undefined}
                className={inputClass}
              >
                <option value="" disabled>Select a scenario</option>
                {LEAD_SCENARIOS.map((value) => <option key={value} value={value}>{scenarioLabels[value]}</option>)}
              </select>
            </div>

            <div className="flex items-start gap-3">
              <input
                id="shortlist-permission"
                name="contactPermission"
                type="checkbox"
                required
                checked={permission}
                onChange={(event) => { setPermission(event.target.checked); clearRetryIdentity(); }}
                aria-invalid={state === "validation_error" && !permission ? true : undefined}
                className="mt-1 size-5 shrink-0 rounded border-slate-400 text-sky-800 focus:ring-2 focus:ring-sky-700/30"
              />
              <label htmlFor="shortlist-permission" className="text-sm leading-6 text-slate-700">
                I agree to be contacted about this request. This is not a newsletter subscription.
              </label>
            </div>

            <div className="absolute -left-[10000px] top-auto size-px overflow-hidden" aria-hidden="true">
              <label htmlFor="shortlist-website">Leave this field empty</label>
              <input id="shortlist-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>

            <p id="shortlist-error" role="alert" aria-live="assertive" className={errorMessage ? "text-sm font-medium text-rose-800" : "sr-only"}>
              {errorMessage || ""}
            </p>

            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-800 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Sending request…" : "Request a shortlist"}
            </button>
            <p aria-live="polite" role="status" className="min-h-6 text-sm text-slate-600">
              {busy ? "Submitting your request." : errorMessage}
            </p>
          </div>
        </form>
      )}
    </section>
  );
}
