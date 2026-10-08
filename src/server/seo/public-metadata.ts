import "server-only";
import type { Metadata } from "next";
import { absoluteCanonical, homePath } from "../../domain/public-urls";
import { resolveAppEnvironment } from "../config/environment";
import { trustedOrigins } from "../config/origins";

export function canonicalUrl(path: string): string {
  return absoluteCanonical(trustedOrigins(resolveAppEnvironment())[0], path);
}

export function publicPageMetadata(input: { readonly title: string; readonly description: string; readonly path: string; readonly index?: boolean }): Metadata {
  const url = canonicalUrl(input.path);
  return {
    title: input.title, description: input.description,
    alternates: { canonical: url },
    openGraph: { title: input.title, description: input.description, url, locale: "en", type: "website" },
    robots: { index: resolveAppEnvironment() === "production" && input.index !== false, follow: true },
  };
}

export function pageJsonLd(input: { readonly title: string; readonly description: string; readonly path: string; readonly type?: "WebPage" | "WebSite" | "CollectionPage" }) {
  const url = canonicalUrl(input.path);
  return { "@context": "https://schema.org", "@type": input.type ?? "WebPage", "@id": `${url}#page`,
    url, name: input.title, description: input.description, inLanguage: "en" };
}

export function breadcrumbJsonLd(items: readonly { readonly name: string; readonly path: string }[]) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement:
    [{ name: "Home", path: homePath() }, ...items].map((item, index) => ({ "@type": "ListItem", position: index + 1,
      name: item.name, item: canonicalUrl(item.path) })) };
}
