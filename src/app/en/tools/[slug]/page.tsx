import Link from "next/link";
import type { Metadata } from "next";
import { cookies, draftMode } from "next/headers";
import { notFound } from "next/navigation";
import { productPath, shortlistPath } from "@/domain/public-urls";
import { selectComponentTarget } from "@/server/config/targets";
import { readPublicProduct } from "@/server/catalog/read-model";
import { isValidPreviewSession, PREVIEW_SESSION_COOKIE } from "@/server/sanity/preview-session";
import { readPreviewProduct } from "@/server/sanity/preview-read";

export const dynamic = "force-dynamic";

type Props = { readonly params: Promise<{ readonly slug: string }> };

function robotsNoIndex(): Metadata["robots"] { return { index: false, follow: false }; }

async function previewProduct(slug: string) {
  try {
    const mode = await draftMode();
    if (!mode.isEnabled) return undefined;
    const target = selectComponentTarget("preview");
    if (target.mode !== "live") return undefined;
    const cookie = (await cookies()).get(PREVIEW_SESSION_COOKIE)?.value;
    if (!isValidPreviewSession({ value: cookie, secret: target.settings.PREVIEW_SESSION_SECRET, environment: target.environment })) return undefined;
    return await readPreviewProduct(slug);
  } catch { return undefined; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const preview = await previewProduct(slug);
  if (preview) return { title: `Preview: ${preview.displayName ?? "CMS guide"}`, robots: robotsNoIndex(), alternates: { canonical: productPath(slug) } };
  const result = await readPublicProduct(slug);
  if (result.status !== 200) return { title: result.status === 503 ? "Content temporarily unavailable" : "Page not found", robots: robotsNoIndex() };
  return {
    title: result.product.content.seo.title,
    description: result.product.content.seo.description,
    alternates: { canonical: productPath(result.product.product.routeSlug) },
  };
}

function portableText(value: readonly unknown[]): string {
  return value.flatMap((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return [];
    const children = (input as { children?: unknown }).children;
    return Array.isArray(children) ? children.flatMap((child) => child && typeof child === "object" && !Array.isArray(child) && typeof (child as { text?: unknown }).text === "string" ? [(child as { text: string }).text] : []) : [];
  }).join(" ").trim();
}

function PreviewPage({ value }: { readonly value: NonNullable<Awaited<ReturnType<typeof readPreviewProduct>>> }) {
  return <main className="mx-auto min-h-screen max-w-4xl px-6 py-16 sm:px-10"><p className="mb-4 rounded border border-amber-500 bg-amber-50 px-3 py-2 font-medium text-amber-950">Private draft preview · noindex</p><h1 className="text-4xl font-semibold">{value.displayName ?? "Untitled CMS guide"}</h1>{value.summary ? <p className="mt-6 text-lg leading-8">{value.summary}</p> : <p className="mt-6 text-slate-600">The English content draft is incomplete.</p>}{value.useCases?.length ? <section className="mt-10"><h2 className="text-2xl font-semibold">Use cases</h2><ul className="mt-3 list-disc space-y-2 pl-6">{value.useCases.map((item, index) => <li key={`${item.key ?? "item"}-${index}`}>{item.text}</li>)}</ul></section> : null}</main>;
}

function MetricList({ result }: { readonly result: Extract<Awaited<ReturnType<typeof readPublicProduct>>, { status: 200 }> }) {
  if (result.metrics.status === "unavailable") return <p className="mt-3 text-slate-600">Package and repository metrics are temporarily unavailable. Editorial information remains available.</p>;
  const labels: Record<string, string> = { downloads_30d: "Package downloads in the last 30 days", stars: "Repository stars", open_issues: "Open repository issues", license: "Repository license" };
  return <ul className="mt-3 grid gap-3 sm:grid-cols-2">{result.metrics.values.map((metric) => <li key={`${metric.productId}-${metric.metric}`} className="rounded-lg border border-slate-300 p-4"><h3 className="font-medium">{labels[metric.metric]}</h3><p className="mt-1 text-2xl font-semibold">{metric.value ?? "Unavailable"}</p><p className="mt-1 text-sm text-slate-600">{metric.status === "ok" ? `${metric.freshness} · observed ${metric.observedAt ?? "date unavailable"}${metric.periodStart && metric.periodEnd ? ` · ${metric.periodStart} to ${metric.periodEnd}` : ""}` : `${metric.status}${metric.reason ? ` · ${metric.reason}` : ""}`}</p></li>)}</ul>;
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const preview = await previewProduct(slug);
  if (preview) return <PreviewPage value={preview} />;
  const result = await readPublicProduct(slug);
  if (result.status === 404) notFound();
  if (result.status === 503) return <main className="mx-auto min-h-screen max-w-4xl px-6 py-16"><h1 className="text-3xl font-semibold">Content temporarily unavailable</h1><p className="mt-4">Please try again later.</p></main>;
  const { product, content } = result.product;
  const ai = result.aiReadiness;
  return <main className="mx-auto min-h-screen max-w-5xl px-6 py-16 sm:px-10">
    <nav aria-label="Breadcrumb" className="text-sm text-slate-600"><Link href="/en/">Home</Link><span aria-hidden="true"> / </span><span>CMS guides</span></nav>
    <header className="mt-8"><p className="text-sm font-semibold tracking-widest text-slate-600 uppercase">CMS guide</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{product.displayName}</h1><p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">{content.summary}</p><div className="mt-5 flex flex-wrap gap-4"><a className="underline underline-offset-4" href={product.officialWebsiteUrl} rel="noopener noreferrer">Official website</a><a className="underline underline-offset-4" href={product.officialDocsUrl} rel="noopener noreferrer">Official documentation</a></div></header>
    <section className="mt-12" aria-labelledby="metrics-title"><h2 id="metrics-title" className="text-2xl font-semibold">Package and repository data</h2><MetricList result={result} /></section>
    <section className="mt-12" aria-labelledby="ai-title"><h2 id="ai-title" className="text-2xl font-semibold">AI support review</h2>{ai ? <><p className="mt-3">{ai.score === null ? `Score unavailable · ${ai.completeness}` : `Readiness score: ${ai.score}/100`}</p>{ai.stale ? <p className="mt-2 text-amber-900">Checked over 90 days ago.</p> : null}<ul className="mt-4 grid gap-3 sm:grid-cols-3">{ai.signals.map((signal) => <li key={signal.key} className="rounded-lg border border-slate-300 p-4"><h3 className="font-medium">{signal.key}</h3><p className="mt-1">{signal.state.replaceAll("_", " ")}</p>{signal.reason ? <p className="mt-1 text-sm text-slate-600">{signal.reason.replaceAll("_", " ")}</p> : null}</li>)}</ul><p className="mt-3 text-sm text-slate-600">Review date: {ai.evidenceAsOf ?? "not available"}</p></> : <p className="mt-3 text-slate-600">Review is not available yet.</p>}</section>
    <section className="mt-12"><h2 className="text-2xl font-semibold">Use cases</h2><ul className="mt-4 list-disc space-y-2 pl-6">{content.useCases.map((item) => <li key={item.key}>{item.text}</li>)}</ul></section>
    <section className="mt-12"><h2 className="text-2xl font-semibold">Fit and limitations</h2><div className="mt-4 grid gap-6 sm:grid-cols-2"><div><h3 className="font-medium">A good fit when</h3><ul className="mt-2 list-disc space-y-2 pl-6">{content.fitsWhen.map((item) => <li key={item.key}>{item.text}</li>)}</ul></div><div><h3 className="font-medium">Consider alternatives when</h3><ul className="mt-2 list-disc space-y-2 pl-6">{content.avoidWhen.map((item) => <li key={item.key}>{item.text}</li>)}</ul></div></div><ul className="mt-6 list-disc space-y-2 pl-6">{content.limitations.map((item) => <li key={item.key}>{item.text}</li>)}</ul></section>
    <section className="mt-12"><h2 className="text-2xl font-semibold">JavaScript and TypeScript integration</h2><p className="mt-3 leading-7">{portableText(content.integrationNotes)}</p></section>
    {content.criteriaBlocks.length ? <section className="mt-12"><h2 className="text-2xl font-semibold">Editorial criteria</h2><div className="mt-4 space-y-5">{content.criteriaBlocks.map((criterion) => <article key={criterion.key} className="rounded-lg border border-slate-300 p-5"><h3 className="font-medium">{criterion.key.replaceAll("_", " ")}</h3><p className="mt-2">{portableText(criterion.body)}</p><p className="mt-2 text-sm text-slate-600">Sources: {criterion.sourceKeys.join(", ")}</p></article>)}</div></section> : null}
    <section className="mt-12"><h2 className="text-2xl font-semibold">Sources and review</h2><p className="mt-2 text-slate-600">Editorial review: {content.reviewedAt}</p><ul className="mt-3 list-disc space-y-2 pl-6">{content.sources.map((source) => <li key={source.key}><a className="underline underline-offset-4" href={source.url} rel="noopener noreferrer">{source.title}</a> · accessed {source.accessedAt}</li>)}</ul></section>
    {result.comparisons.length ? <section className="mt-12"><h2 className="text-2xl font-semibold">Comparisons</h2><ul className="mt-3 list-disc space-y-2 pl-6">{result.comparisons.map(({ href, content: comparisonContent }) => <li key={href}><Link className="underline underline-offset-4" href={href}>{comparisonContent.title}</Link></li>)}</ul></section> : null}
    <p className="mt-16"><Link className="rounded-lg bg-slate-900 px-5 py-3 font-medium text-white" href={`${shortlistPath()}?entryPoint=product`}>Request a CMS shortlist</Link></p>
  </main>;
}
