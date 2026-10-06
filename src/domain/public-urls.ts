import type { CategoryId, ComparisonId, ProductId } from "./ids";

export type PublicLocale = "en";

export interface SluggedProduct {
  readonly id: ProductId;
  readonly routeSlug: string;
}

function validSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !value.includes("-vs-");
}

function slugPath(slug: string): string {
  if (!validSlug(slug)) throw new Error("Invalid public route slug.");
  return slug;
}

export const homePath = (locale: PublicLocale = "en"): string => `/${locale}/`;
export const categoryPath = (slug: string, locale: PublicLocale = "en"): string => `/${locale}/categories/${slugPath(slug)}/`;
export const productPath = (slug: string, locale: PublicLocale = "en"): string => `/${locale}/tools/${slugPath(slug)}/`;
export const comparisonPath = (
  products: readonly [SluggedProduct, SluggedProduct],
  locale: PublicLocale = "en",
): string => {
  if (products[0].id === products[1].id) throw new Error("A comparison needs two different products.");
  const [first, second] = [...products].sort((a, b) => a.id.localeCompare(b.id));
  return `/${locale}/compare/${slugPath(first.routeSlug)}-vs-${slugPath(second.routeSlug)}/`;
};
export const methodologyPath = (locale: PublicLocale = "en"): string => `/${locale}/methodology/ai-readiness/`;
export const shortlistPath = (locale: PublicLocale = "en"): string => `/${locale}/request-shortlist/`;
export const privacyPath = (locale: PublicLocale = "en"): string => `/${locale}/privacy/`;

export function absoluteCanonical(origin: string, path: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("Invalid canonical origin.");
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Invalid canonical origin.");
  }
  if (!path.startsWith("/") || !path.endsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) {
    throw new Error("Invalid canonical path.");
  }
  return new URL(path, parsed.origin).toString();
}

export type { CategoryId, ComparisonId, ProductId };
