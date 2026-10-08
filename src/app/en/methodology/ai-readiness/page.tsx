import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { homePath, methodologyPath } from "@/domain/public-urls";
import { getPublishedCatalogRead } from "@/server/sanity/public-read";
import { breadcrumbJsonLd, pageJsonLd, publicPageMetadata } from "@/server/seo/public-metadata";
import { JsonLd } from "@/features/content/json-ld";
import { PortableText } from "@/features/content/portable-text";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return { title: "Content temporarily unavailable", robots: { index: false, follow: false } };
  const page = result.model.pages.find((item) => item.pageKey === "aiMethodology");
  return page ? publicPageMetadata({ ...page.seo, path: methodologyPath() })
    : { title: "Page not found", robots: { index: false, follow: false } };
}

export default async function MethodologyPage() {
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return <main><h1>Content temporarily unavailable</h1><p>Please try again later.</p></main>;
  const page = result.model.pages.find((item) => item.pageKey === "aiMethodology");
  if (!page) notFound();
  return <main className="mx-auto min-h-screen max-w-4xl px-6 py-16 pb-60 sm:px-10">
    <JsonLd value={[pageJsonLd({ title: page.title, description: page.seo.description, path: methodologyPath() }),
      breadcrumbJsonLd([{ name: page.title, path: methodologyPath() }])]} />
    <nav aria-label="Breadcrumb"><Link href={homePath()} className="underline">Home</Link><span aria-hidden="true"> / </span><span>{page.title}</span></nav>
    <h1 className="mt-8 text-4xl font-semibold">{page.title}</h1>
    {page.sections.map((section) => section._type === "richTextSection" ? <section key={String(section.sectionKey)} className="mt-10">
      {typeof section.heading === "string" ? <h2 className="text-2xl font-semibold">{section.heading}</h2> : null}
      <PortableText value={Array.isArray(section.body) ? section.body : []} />
    </section> : section._type === "aiScoreExample" ? <section key={String(section.sectionKey)} className="mt-10 rounded-xl border border-slate-300 p-6">
      <h2 className="text-2xl font-semibold">Example score</h2>
      <p className="mt-4">Types: {String(section.typesKind)}; llms.txt: {section.llmsTxtPresent ? "present" : "absent"}; MCP: {section.mcpPresent ? "present" : "absent"}.</p>
      <p className="mt-3">Score: {Math.floor(100 * (25 * (section.typesKind === "bundled" ? 1 : section.typesKind === "external" ? 0.5 : 0) + 20 * Number(section.llmsTxtPresent) + 20 * Number(section.mcpPresent)) / 65 + 0.5)} / 100</p>
    </section> : null)}
    <section className="mt-10 rounded-xl border border-slate-300 p-6" aria-labelledby="formula-title">
      <h2 id="formula-title" className="text-2xl font-semibold">How the score is calculated</h2>
      <p className="mt-4">Version: <code>cms-ai-support-v1</code>. Score = round(100 × (25 × types + 20 × llms.txt + 20 × MCP) / 65).</p>
      <p className="mt-4">Bundled SDK types count as 1; external types count as 0.5; no types count as 0. Official llms.txt and MCP count as 1 when present and 0 when absent.</p>
      <p className="mt-4">Unknown or failed required checks leave the score unavailable. Products without a comparable SDK are not applicable. Evidence older than 90 days is marked stale.</p>
      <p className="mt-4">This score describes documented support signals. It is not an overall CMS rating or a measurement of AI performance.</p>
    </section>
  </main>;
}
