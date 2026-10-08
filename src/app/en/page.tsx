import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedCatalogRead, type CmsPublicReadModel } from "@/server/sanity/public-read";
import { categoryPath, productPath, comparisonPath, methodologyPath, shortlistPath, privacyPath, homePath } from "@/domain/public-urls";
import { pageJsonLd, publicPageMetadata } from "@/server/seo/public-metadata";
import { JsonLd } from "@/features/content/json-ld";
import { PortableText } from "@/features/content/portable-text";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return { title: "Content temporarily unavailable", robots: { index: false, follow: false } };
  const home = result.model.pages.find((page) => page.pageKey === "home");
  return home ? publicPageMetadata({ ...home.seo, path: homePath() })
    : { title: "Page not found", robots: { index: false, follow: false } };
}

function HomeSection({ section, model }: { readonly section: Readonly<Record<string, unknown>>; readonly model: CmsPublicReadModel }) {
  const heading = typeof section.heading === "string" ? section.heading : "";
  const body = Array.isArray(section.body) ? section.body : [];
  const ids = (key: string): readonly string[] => Array.isArray(section[key]) ? section[key].filter((id): id is string => typeof id === "string") : [];
  switch (section._type) {
    case "heroSection": {
      const reference = section.primaryCategory as { readonly _ref?: string } | undefined;
      const category = model.categories.find((item) => item.id === reference?._ref);
      return <header><h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">{heading}</h1>
        <PortableText value={body} /><div className="mt-6 flex flex-wrap gap-5 underline underline-offset-4">
          {category ? <Link href={categoryPath(category.routeSlug)}>{category.content.title}</Link> : null}
          {typeof section.secondaryRequestLabel === "string" ? <Link href={`${shortlistPath()}?entryPoint=home`}>{section.secondaryRequestLabel}</Link> : null}
        </div></header>;
    }
    case "categoryLinksSection":
      return <section className="mt-12"><h2 className="text-2xl font-semibold">{heading}</h2><ul className="mt-4 space-y-3">{ids("categoryIds").map((id) => {
        const category = model.categories.find((item) => item.id === id);
        return category ? <li key={id}><Link href={categoryPath(category.routeSlug)} className="underline underline-offset-4">{category.content.title}</Link></li> : null;
      })}</ul></section>;
    case "featuredProductsSection":
      return <section className="mt-12"><h2 className="text-2xl font-semibold">{heading}</h2><ul className="mt-6 grid gap-6 sm:grid-cols-2">{ids("productIds").map((id) => {
        const item = model.products.find(({ product }) => product.id === id);
        return item ? <li key={id} className="rounded-xl border border-slate-300 p-6"><h3 className="text-xl font-semibold"><Link href={productPath(item.product.routeSlug)} className="underline underline-offset-4">{item.product.displayName}</Link></h3><p className="mt-3">{item.content.summary}</p></li> : null;
      })}</ul></section>;
    case "featuredComparisonsSection":
      return <section className="mt-12"><h2 className="text-2xl font-semibold">{heading}</h2><ul className="mt-4 space-y-3">{ids("comparisonIds").map((id) => {
        const item = model.comparisons.find(({ comparison }) => comparison.id === id);
        if (!item) return null;
        const first = model.products.find(({ product }) => product.id === item.comparison.productIds[0])?.product;
        const second = model.products.find(({ product }) => product.id === item.comparison.productIds[1])?.product;
        return first && second ? <li key={id}><Link href={comparisonPath([first, second])} className="underline underline-offset-4">{item.content.title}</Link></li> : null;
      })}</ul></section>;
    case "methodologyTeaserSection":
      return <section className="mt-12"><h2 className="text-2xl font-semibold">{heading}</h2><PortableText value={body} />
        {model.pages.some((page) => page.pageKey === "aiMethodology") ? <Link href={methodologyPath()} className="mt-4 inline-block underline underline-offset-4">Read the AI readiness methodology</Link> : null}
      </section>;
    default: return null;
  }
}

export default async function EnglishHome() {
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return <main><h1>Content temporarily unavailable</h1><p>Please try again later.</p></main>;
  const { model } = result;
  const home = model.pages.find((page) => page.pageKey === "home");
  if (!home) notFound();
  return <main className="mx-auto min-h-screen max-w-5xl px-6 py-20 pb-60 sm:px-10">
    <JsonLd value={pageJsonLd({ title: home.title, description: home.seo.description, path: homePath(), type: "WebSite" })} />
    <p className="mb-8 text-sm font-semibold tracking-widest text-slate-600 uppercase">{model.siteSettings?.siteName ?? "PkgCompass"}</p>
    {home.sections.map((section) => <HomeSection key={String(section.sectionKey)} section={section} model={model} />)}
    <footer className="mt-16"><Link href={privacyPath()} className="underline underline-offset-4">Privacy notice</Link></footer>
  </main>;
}
