import Link from "next/link";
import type { Metadata } from "next";
import { getPublishedCatalogRead } from "@/server/sanity/public-read";
import { categoryPath, productPath, comparisonPath, methodologyPath, shortlistPath, privacyPath } from "@/domain/public-urls";

export async function generateMetadata(): Promise<Metadata> {
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return { title: "Content temporarily unavailable", robots: { index: false, follow: false } };
  const home = result.model.pages.find((page) => page.pageKey === "home");
  return { title: home?.seo.title ?? "PkgCompass — Headless CMS guide", description: home?.seo.description, alternates: { canonical: "/en/" } };
}

export default async function EnglishHome() {
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return <main><h1>Content temporarily unavailable</h1><p>Please try again later.</p></main>;
  const { model } = result;
  const home = model.pages.find((page) => page.pageKey === "home");
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-20 pb-60 sm:px-10">
      <p className="mb-8 text-sm font-semibold tracking-widest text-slate-600 uppercase">PkgCompass</p>
      <h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-tight text-slate-950 sm:text-6xl">{home?.title ?? "Headless CMS guidance for JavaScript and TypeScript teams."}</h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Compare editorial guidance, official SDK sources and dated package metrics.</p>
      <nav aria-label="Main" className="mt-8 flex flex-wrap gap-5 underline underline-offset-4">
        {model.categories.map((category) => <Link key={category.id} href={categoryPath(category.routeSlug)}>{category.content.title}</Link>)}
        <Link href={methodologyPath()}>AI readiness methodology</Link>
        <Link href={`${shortlistPath()}?entryPoint=home`}>Request a shortlist</Link>
      </nav>
      <section aria-labelledby="cms-list-title" className="mt-12">
        <h2 id="cms-list-title" className="text-2xl font-semibold">CMS guides</h2>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2">
          {model.products.map(({ product, content }) => <li key={product.id} className="rounded-xl border border-slate-300 p-6"><h3 className="text-xl font-semibold"><Link href={productPath(product.routeSlug)} className="underline underline-offset-4">{product.displayName}</Link></h3><p className="mt-3 text-slate-700">{content.summary}</p></li>)}
        </ul>
      </section>
      <section aria-labelledby="comparisons-title" className="mt-12">
        <h2 id="comparisons-title" className="text-2xl font-semibold">Comparisons</h2>
        <ul className="mt-4 space-y-3">{model.comparisons.map(({ comparison, content }) => {
          const pair = comparison.productIds.map((id) => model.products.find(({ product }) => product.id === id)?.product);
          return pair[0] && pair[1] ? <li key={comparison.id}><Link className="underline underline-offset-4" href={comparisonPath([pair[0], pair[1]])}>{content.title}</Link></li> : null;
        })}</ul>
      </section>
      <footer className="mt-16"><Link href={privacyPath()} className="underline underline-offset-4">Privacy notice</Link></footer>
    </main>
  );
}
