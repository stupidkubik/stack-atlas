import type { Metadata } from "next";
import Link from "next/link";
import { ShortlistForm } from "@/features/leads/shortlist-form";

export const metadata: Metadata = {
  title: "Request a CMS shortlist | PkgCompass",
  description: "Ask for free, non-commercial help choosing a CMS for your website.",
  alternates: { canonical: "/en/request-shortlist/" },
  robots: { index: false, follow: false },
};

const entryPoints = ["nav", "comparison", "product", "home"] as const;
type EntryPoint = typeof entryPoints[number];

function resolveEntryPoint(value: string | string[] | undefined): EntryPoint {
  return typeof value === "string" && entryPoints.includes(value as EntryPoint)
    ? value as EntryPoint
    : "home";
}

export default async function RequestShortlistPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly entryPoint?: string | string[] }>;
}) {
  const { entryPoint } = await searchParams;
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-12 sm:px-8 sm:py-20">
      <div className="mb-12 flex items-center justify-between gap-6">
        <Link href="/en/" className="text-sm font-semibold tracking-[0.16em] text-slate-700 uppercase">PkgCompass</Link>
        <Link href="/en/privacy/" className="text-sm font-medium text-slate-700 underline decoration-slate-400 underline-offset-4 hover:text-slate-950">Privacy</Link>
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(380px,1.1fr)] lg:items-start">
        <div className="pt-2">
          <p className="text-sm font-semibold tracking-[0.14em] text-sky-800 uppercase">A personal request</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Request a CMS shortlist</h1>
          <p className="mt-6 text-lg leading-8 text-slate-700">
            Tell us what kind of site you are building, and the project owner can help narrow down the options.
          </p>
          <p className="mt-4 leading-7 text-slate-600">
            The help is free and non-commercial. There is no promised response time, and this request does not sign you up for email marketing.
          </p>
          <p className="mt-6 text-sm leading-6 text-slate-600">
            Your address is used only to respond to this request. Read the <Link href="/en/privacy/" className="font-medium text-slate-900 underline underline-offset-4">privacy notice</Link> for details.
          </p>
        </div>
        <ShortlistForm entryPoint={resolveEntryPoint(entryPoint)} />
      </div>
    </main>
  );
}
