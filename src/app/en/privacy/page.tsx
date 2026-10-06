import type { Metadata } from "next";
import Link from "next/link";
import { resolveAppEnvironment } from "@/server/config/environment";

export const metadata: Metadata = {
  title: "Privacy | PkgCompass",
  description: "How PkgCompass handles shortlist requests and optional analytics.",
  robots: { index: false, follow: false },
};

function getPrivacyContact(): string | undefined {
  let environment;
  try { environment = resolveAppEnvironment(); } catch { return undefined; }
  if (environment === "fixture") return "local-development@invalid.example";
  const contact = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  if (!contact || contact.length > 254 || /[\u0000-\u001f\u007f]/.test(contact) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return undefined;
  return contact;
}

export default function PrivacyPage() {
  const contact = getPrivacyContact();
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-12 sm:px-8 sm:py-20">
      <Link href="/en/" className="text-sm font-semibold tracking-[0.16em] text-slate-700 uppercase">PkgCompass</Link>
      <article className="mt-12">
        <p className="text-sm font-semibold tracking-[0.14em] text-sky-800 uppercase">Privacy notice</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">Your information and choices</h1>
        <section className="mt-8 space-y-5 leading-7 text-slate-700">
          <p>PkgCompass is a non-commercial learning project. A shortlist request is a request for a personal reply, not a newsletter subscription or an automated email.</p>
          <h2 className="pt-3 text-xl font-semibold text-slate-950">Shortlist requests</h2>
          <p>The email address and selected website scenario are sent to the project owner’s Brevo contact workspace so the owner can reply. The application database stores request status and privacy-preserving deduplication values, not the email address. Request records and the project contact data are scheduled for deletion after 30 days.</p>
          <p>You can request deletion of your contact information by writing to {contact ? <a className="font-medium text-slate-900 underline underline-offset-4" href={`mailto:${contact}`}>{contact}</a> : "the project privacy contact, which will be published before public release"}.</p>
          <h2 className="pt-3 text-xl font-semibold text-slate-950">Optional analytics</h2>
          <p>Analytics is optional and does not affect the shortlist form. If enabled, PkgCompass uses PostHog hosted in the EU to understand aggregate page and request flows. Analytics is not linked to your email address. You can change your choice at any time.</p>
          <p>Before public release, this notice will identify the active analytics retention period and the project privacy contact.</p>
          <Link href="/en/request-shortlist/" className="inline-flex rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Back to shortlist request</Link>
        </section>
      </article>
    </main>
  );
}
