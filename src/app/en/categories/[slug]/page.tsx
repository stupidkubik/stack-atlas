import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categoryPath, comparisonPath, homePath, productPath } from "@/domain/public-urls";
import { getPublishedCatalogRead } from "@/server/sanity/public-read";
import { breadcrumbJsonLd, canonicalUrl, pageJsonLd, publicPageMetadata } from "@/server/seo/public-metadata";
import { JsonLd } from "@/features/content/json-ld";
import { PortableText } from "@/features/content/portable-text";

export const dynamic = "force-dynamic";
type Props = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return { title: "Content temporarily unavailable", robots: { index: false, follow: false } };
  const category = result.model.categories.find((item) => item.routeSlug === slug);
  if (!category) return { title: "Page not found", robots: { index: false, follow: false } };
  return publicPageMetadata({ ...category.content.seo, path: categoryPath(category.routeSlug) });
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return <main><h1>Content temporarily unavailable</h1><p>Please try again later.</p></main>;
  const category = result.model.categories.find((item) => item.routeSlug === slug);
  if (!category) notFound();
  const products = result.model.products.filter(({ product }) => product.categoryIds.includes(category.id))
    .toSorted((a, b) => a.product.displayName.localeCompare(b.product.displayName, "en"));
  const productsById = new Map(products.map(({ product }) => [product.id, product]));
  const comparisons = result.model.comparisons.filter(({ comparison }) => comparison.categoryId === category.id);
  const path = categoryPath(category.routeSlug);
  return <main className="mx-auto min-h-screen max-w-5xl px-6 py-16 pb-60 sm:px-10">
    <JsonLd value={[pageJsonLd({ title: category.content.title, description: category.content.seo.description, path, type: "CollectionPage" }),
      { "@context": "https://schema.org", "@type": "ItemList", itemListElement: products.map(({ product }, index) => ({ "@type": "ListItem",
        position: index + 1, name: product.displayName, url: canonicalUrl(productPath(product.routeSlug)) })) },
      breadcrumbJsonLd([{ name: category.content.title, path }])]} />
    <nav aria-label="Breadcrumb"><Link href={homePath()} className="underline">Home</Link><span aria-hidden="true"> / </span><span>{category.content.title}</span></nav>
    <h1 className="mt-8 text-4xl font-semibold">{category.content.title}</h1>
    <PortableText value={category.content.intro} />
    <h2 className="mt-12 text-2xl font-semibold">CMS guides</h2>
    {products.length ? <ul className="mt-6 grid gap-6 sm:grid-cols-2">{products.map(({ product, content }) => <li key={product.id} className="rounded-xl border border-slate-300 p-6">
      <h3 className="text-xl font-semibold"><Link href={productPath(product.routeSlug)} className="underline underline-offset-4">{product.displayName}</Link></h3><p className="mt-3">{content.summary}</p>
    </li>)}</ul> : <p className="mt-4">No published CMS guides are available in this category yet.</p>}
    {comparisons.length ? <section className="mt-12"><h2 className="text-2xl font-semibold">Comparisons</h2><ul className="mt-4 space-y-3">{comparisons.map(({ comparison, content }) => {
      const first = productsById.get(comparison.productIds[0]); const second = productsById.get(comparison.productIds[1]);
      return first && second ? <li key={comparison.id}><Link href={comparisonPath([first, second])} className="underline underline-offset-4">{content.title}</Link></li> : null;
    })}</ul></section> : null}
  </main>;
}
