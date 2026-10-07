import Link from "next/link";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { comparisonPath, shortlistPath } from "@/domain/public-urls";
import { getPublishedCatalogRead, getPublishedComparisonRouteContext } from "@/server/sanity/public-read";
import { ComparisonMeasurement } from "@/features/measurement/comparison-tracker";

export const dynamic = "force-dynamic";

type Props = { readonly params: Promise<{ readonly pair: string }> };
type RouteContext = Awaited<ReturnType<typeof getPublishedComparisonRouteContext>>;

async function comparisonFor(pair: string): Promise<RouteContext> {
  return getPublishedComparisonRouteContext(pair);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pair } = await params;
  const route = await comparisonFor(pair);
  if (route.kind !== "published") return { title: route.kind === "unavailable" ? "Content temporarily unavailable" : "Page not found", robots: { index: false, follow: false } };
  const canonical = `/en/compare/${pair}/`;
  return {
    title: route.comparison.content.seo.title,
    description: route.comparison.content.seo.description,
    alternates: { canonical },
    ...(route.comparison.content.indexingRequested ? {} : { robots: { index: false, follow: true } }),
  };
}

function text(value: readonly unknown[]): string {
  return value.flatMap((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return [];
    const children = (input as { children?: unknown }).children;
    return Array.isArray(children) ? children.flatMap((child) => child && typeof child === "object" && !Array.isArray(child) && typeof (child as { text?: unknown }).text === "string" ? [(child as { text: string }).text] : []) : [];
  }).join(" ").trim();
}

export default async function ComparisonPage({ params }: Props) {
  const { pair } = await params;
  const route = await comparisonFor(pair);
  if (route.kind === "unavailable") return <main className="mx-auto min-h-screen max-w-5xl px-6 py-16"><h1 className="text-3xl font-semibold">Content temporarily unavailable</h1><p className="mt-4">Please try again later.</p></main>;
  if (route.kind === "missing") notFound();
  if (route.kind === "redirect") permanentRedirect(route.location);
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return <main className="mx-auto min-h-screen max-w-5xl px-6 py-16"><h1 className="text-3xl font-semibold">Content temporarily unavailable</h1></main>;
  const comparison = route.comparison;
  const productsById = new Map<string, (typeof result.model.products)[number]["product"]>(result.model.products.map(({ product }) => [product.id, product]));
  const displayProducts = comparison.comparison.displayOrder.map((id) => productsById.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (displayProducts.length !== 2) notFound();
  return <main className="mx-auto min-h-screen max-w-5xl px-6 py-16 sm:px-10">
    <ComparisonMeasurement comparisonId={comparison.comparison.id} productIds={displayProducts.map((product) => product.id)} />
    <nav aria-label="Breadcrumb" className="text-sm text-slate-600"><Link href="/en/">Home</Link><span aria-hidden="true"> / </span><Link href="/en/">CMS guides</Link><span aria-hidden="true"> / </span><span>Comparison</span></nav>
    <header className="mt-8"><p className="text-sm font-semibold tracking-widest text-slate-600 uppercase">Editorial comparison</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{comparison.content.title}</h1><p className="mt-5 text-lg leading-8">{text(comparison.content.taskContext)}</p>{comparison.content.disclosure ? <p className="mt-4 rounded-lg border border-slate-300 p-4 text-sm">Disclosure: {comparison.content.disclosure}</p> : null}</header>
    <section className="mt-12"><h2 className="text-2xl font-semibold">Criteria</h2><div className="mt-4 overflow-x-auto rounded-lg border border-slate-300"><table className="w-full min-w-[42rem] border-collapse text-left"><caption className="sr-only">Comparison criteria for {displayProducts[0].displayName} and {displayProducts[1].displayName}</caption><thead><tr><th scope="col" className="border-b border-slate-300 p-4">Criterion</th>{displayProducts.map((product) => <th scope="col" key={product.id} className="border-b border-slate-300 p-4">{product.displayName}</th>)}</tr></thead><tbody>{comparison.content.criteria.map((criterion) => <tr key={criterion.key}><th scope="row" className="border-b border-slate-200 p-4 align-top"><span className="font-semibold">{criterion.label}</span>{criterion.importanceNote ? <p className="mt-2 text-sm font-normal text-slate-600">{criterion.importanceNote}</p> : null}</th>{displayProducts.map((product) => {
      const cell = criterion.cells.find(({ productId }) => productId === product.id);
      return <td key={`${criterion.key}-${product.id}`} className="border-b border-slate-200 p-4 align-top">{cell?.text ?? "No published evidence for this cell."}{cell?.sourceKeys.length ? <p className="mt-2 text-xs text-slate-600">Sources: {cell.sourceKeys.join(", ")}</p> : null}</td>;
    })}</tr>)}</tbody></table></div></section>
    <section className="mt-12"><h2 className="text-2xl font-semibold">When to choose each CMS</h2><div className="mt-4 grid gap-5 sm:grid-cols-2">{comparison.content.choiceGuidance.map((choice) => <article key={choice.productId} className="rounded-lg border border-slate-300 p-5"><h3 className="font-semibold">{productsById.get(choice.productId)?.displayName ?? "CMS"}</h3><ul className="mt-3 list-disc space-y-2 pl-6">{choice.conditions.map((condition) => <li key={condition.key}>{condition.text}</li>)}</ul></article>)}</div></section>
    <section className="mt-12"><h2 className="text-2xl font-semibold">Editorial verdict</h2><p className="mt-3 leading-7">{text(comparison.content.verdict)}</p><ul className="mt-5 list-disc space-y-2 pl-6">{comparison.content.limitations.map((item) => <li key={item.key}>{item.text}</li>)}</ul><p className="mt-3 text-sm text-slate-600">Reviewed {comparison.content.reviewedAt}</p></section>
    <section className="mt-12"><h2 className="text-2xl font-semibold">Sources</h2><ul className="mt-3 list-disc space-y-2 pl-6">{comparison.content.sources.map((source) => <li key={source.key}><a className="underline underline-offset-4" href={source.url} rel="noopener noreferrer">{source.title}</a> · accessed {source.accessedAt}</li>)}</ul></section>
    <p className="mt-12"><Link className="inline-flex rounded-lg bg-slate-900 px-5 py-3 font-medium text-white" href={`${shortlistPath()}?entryPoint=comparison`}>Ask for help choosing between these CMS options</Link></p>
    <p className="mt-12 flex flex-wrap gap-5">{displayProducts.map((product) => <Link key={product.id} className="underline underline-offset-4" href={`/en/tools/${product.routeSlug}/`}>{product.displayName} guide</Link>)}<Link className="underline underline-offset-4" href={comparisonPath([displayProducts[0], displayProducts[1]])}>Canonical comparison URL</Link></p>
  </main>;
}
