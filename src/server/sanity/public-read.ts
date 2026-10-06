import "server-only";

import { createClient } from "@sanity/client";
import { unstable_cache } from "next/cache";
import { categoryId, comparisonId, packageId, pairKey, productId, repositoryId, type ProductId } from "../../domain/ids";
import { toPublishedCatalog, type AiReviewProjection, type AiSignal, type CatalogSnapshot, type PublishedCatalog } from "../../domain/catalog";
import type { UtcDateTime } from "../../domain/utc";
import { selectComponentTarget } from "../config/targets";
import { fixturePublishedCatalog } from "../fixtures/catalog";

const LIVE_READ_TIMEOUT_MS = 8_000;

const CACHE_SECONDS = 3600;
const CACHE_TAG = "sanity:published-catalog";

/** Only the fields used by public pages and catalog consumers cross the CMS boundary. */
export const PUBLISHED_CMS_QUERY = `{
  "categories": *[_type == "category"]{_id, routeSlug, displayOrder},
  "categoryContent": *[_type == "categoryContent" && locale == "en"]{_id, categoryId, locale, title, intro, seo},
  "products": *[_type == "product"]{_id, displayName, routeSlug, categoryIds[]{_ref}, officialWebsiteUrl, officialDocsUrl, hostingModels, apiStyles, packageIds[]{_ref}, repositoryIds[]{_ref}, primaryPackageId{_ref}, primaryRepositoryId{_ref}},
  "packages": *[_type == "package"]{_id, productId{_ref}, packageName, role, officialSourceUrl},
  "repositories": *[_type == "repository"]{_id, productId{_ref}, owner, name, scope, packageId{_ref}, role, officialSourceUrl},
  "productContent": *[_type == "productContent" && locale == "en"]{_id, productId{_ref}, locale, summary, useCases[]{key,text}, fitsWhen[]{key,text}, avoidWhen[]{key,text}, limitations[]{key,text}, integrationNotes, criteriaBlocks[]{key,body,sourceKeys}, sources[]{key,title,url,accessedAt}, alternativeIds[]{_ref}, noPackageReason, reviewedAt, seo},
  "comparisons": *[_type == "comparison"]{_id, productIds[]{_ref}, pairKey, categoryId{_ref}, displayOrder[]{_ref}},
  "comparisonContent": *[_type == "comparisonContent" && locale == "en"]{_id, comparisonId{_ref}, locale, title, taskContext, criteria[]{key,label,description,cells[]{productId{_ref},text,sourceKeys},importanceNote}, choiceGuidance[]{productId{_ref},conditions[]{key,text}}, limitations[]{key,text}, verdict, sources[]{key,title,url,accessedAt}, reviewedAt, seo, indexingRequested, disclosure},
  "aiReviews": *[_type == "aiReview"]{_id, productId{_ref}, mappingKey, methodologyVersion, signals[]{key,state,kind,checkedAt,scope,reason,evidence[]{sourceUrl,officialSourceUrl,finding,checkedAt,packageVersion,entryPoints}}, reviewedAt, reviewerLabel},
  "pages": *[_type == "page" && locale == "en"]{_id, pageKey, locale, title, sections, seo},
  "siteSettings": *[_type == "siteSettings"][0]{_id,siteName,defaultLocale,activeLocales,navigation[]{key,label,targetType,categoryId{_ref}},footerLinks[]{_ref}},
  "redirects": *[_type == "redirect"]{_id,sourcePath,targetPath,statusCode,createdAt,reason}
}`;

export interface CmsSource {
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly accessedAt: string;
}

export interface CmsKeyedText {
  readonly key: string;
  readonly text: string;
}

export interface CmsPublicProduct {
  readonly product: {
    readonly id: ProductId;
    readonly displayName: string;
    readonly routeSlug: string;
    readonly categoryIds: readonly string[];
    readonly officialWebsiteUrl: string;
    readonly officialDocsUrl: string;
    readonly hostingModels: readonly string[];
    readonly apiStyles: readonly string[];
    readonly packageIds: readonly string[];
    readonly repositoryIds: readonly string[];
    readonly primaryPackageId?: string;
    readonly primaryRepositoryId?: string;
  };
  readonly content: {
    readonly summary: string;
    readonly useCases: readonly CmsKeyedText[];
    readonly fitsWhen: readonly CmsKeyedText[];
    readonly avoidWhen: readonly CmsKeyedText[];
    readonly limitations: readonly CmsKeyedText[];
    readonly integrationNotes: readonly unknown[];
    readonly criteriaBlocks: readonly { readonly key: string; readonly body: readonly unknown[]; readonly sourceKeys: readonly string[] }[];
    readonly sources: readonly CmsSource[];
    readonly alternativeIds: readonly string[];
    readonly noPackageReason?: string;
    readonly reviewedAt: string;
    readonly seo: { readonly title: string; readonly description: string };
  };
  readonly packages: readonly { readonly id: string; readonly packageName: string; readonly role: string; readonly officialSourceUrl: string }[];
  readonly repositories: readonly { readonly id: string; readonly owner: string; readonly name: string; readonly scope: string; readonly packageId?: string; readonly role: string; readonly officialSourceUrl: string }[];
}

export interface CmsPublicCategory {
  readonly id: string;
  readonly routeSlug: string;
  readonly displayOrder: number;
  readonly content: { readonly title: string; readonly intro: readonly unknown[]; readonly seo: { readonly title: string; readonly description: string } };
}

export interface CmsPublicComparison {
  readonly comparison: { readonly id: string; readonly productIds: readonly [ProductId, ProductId]; readonly pairKey: string; readonly categoryId: string; readonly displayOrder: readonly string[] };
  readonly content: {
    readonly title: string;
    readonly taskContext: readonly unknown[];
    readonly criteria: readonly { readonly key: string; readonly label: string; readonly description?: string; readonly cells: readonly { readonly productId: ProductId; readonly text: string; readonly sourceKeys: readonly string[] }[]; readonly importanceNote?: string }[];
    readonly choiceGuidance: readonly { readonly productId: ProductId; readonly conditions: readonly CmsKeyedText[] }[];
    readonly limitations: readonly CmsKeyedText[];
    readonly verdict: readonly unknown[];
    readonly sources: readonly CmsSource[];
    readonly reviewedAt: string;
    readonly seo: { readonly title: string; readonly description: string };
    readonly indexingRequested: boolean;
    readonly disclosure?: string;
  };
}

export interface CmsPublicPage {
  readonly pageKey: "home" | "aiMethodology" | "privacy";
  readonly title: string;
  readonly sections: readonly Record<string, unknown>[];
  readonly seo: { readonly title: string; readonly description: string };
}

export interface CmsPublicRedirect {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly createdAt: string;
  readonly reason: string;
}

export interface CmsPublicReadModel {
  readonly catalog: PublishedCatalog;
  readonly products: readonly CmsPublicProduct[];
  readonly categories: readonly CmsPublicCategory[];
  readonly comparisons: readonly CmsPublicComparison[];
  readonly pages: readonly CmsPublicPage[];
  readonly siteSettings?: {
    readonly siteName: string;
    readonly navigation: readonly Record<string, unknown>[];
    readonly footerPageKeys: readonly string[];
  };
  readonly redirects: readonly CmsPublicRedirect[];
}

export type CmsReadResult =
  | { readonly status: 200; readonly source: "live" | "valid_cache" | "fixture"; readonly model: CmsPublicReadModel }
  | { readonly status: 503; readonly code: "cms_unavailable" };

type RecordValue = Record<string, unknown>;
type Query = (groq: string, params?: Record<string, unknown>) => Promise<unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function list(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function ref(value: unknown): string | undefined {
  const item = record(value);
  return typeof item?._ref === "string" ? item._ref : undefined;
}

function refs(value: unknown): string[] | undefined {
  const values = list(value);
  if (!values) return undefined;
  const result = values.map(ref);
  return result.every((item): item is string => Boolean(item)) && new Set(result).size === result.length ? result : undefined;
}

function validSlug(value: unknown): string | undefined {
  const current = record(value)?.current;
  return typeof current === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(current) && !current.includes("-vs-") ? current : undefined;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 5 * 60_000;
}

function validSeo(value: unknown): { title: string; description: string } | undefined {
  const item = record(value);
  return text(item?.title) && item.title.length <= 70 && text(item.description) && item.description.length <= 180
    ? { title: item.title, description: item.description }
    : undefined;
}

function portableText(value: unknown): readonly unknown[] | undefined {
  const blocks = list(value);
  if (!blocks?.length) return undefined;
  const projected = blocks.map((input) => {
    const block = record(input);
    const children = list(block?.children);
    const marks = list(block?.markDefs);
    if (block?._type !== "block" || !children?.length || !marks) return undefined;
    const style = block.style ?? "normal";
    if (!["normal", "h2", "h3"].includes(String(style))) return undefined;
    if ((block.listItem !== undefined && !["bullet", "number"].includes(String(block.listItem))) ||
      (block.level !== undefined && (!Number.isSafeInteger(block.level) || Number(block.level) < 1 || Number(block.level) > 3)) ||
      (block.listItem === undefined && block.level !== undefined)) return undefined;
    const safeMarks = marks.map((markInput) => {
      const mark = record(markInput);
      return mark?._type === "safeLink" && text(mark._key) && /^[A-Za-z0-9_-]{1,80}$/.test(mark._key) && isHttpUrl(mark.href)
        ? { _type: "safeLink", _key: mark._key, href: mark.href }
        : undefined;
    });
    if (safeMarks.some((mark) => !mark) || new Set(safeMarks.map((mark) => mark?._key)).size !== safeMarks.length) return undefined;
    const markKeys = new Set(safeMarks.flatMap((mark) => mark?._key ? [mark._key] : []));
    const safeChildren = children.map((childInput) => {
      const child = record(childInput);
      const childMarks = list(child?.marks);
      return child?._type === "span" && typeof child.text === "string" && child.text.length <= 10_000 && childMarks?.every((mark) => typeof mark === "string" && (["strong", "em", "code"].includes(mark) || markKeys.has(mark)))
        ? { _type: "span", ...(text(child._key) && /^[A-Za-z0-9_-]{1,80}$/.test(child._key) ? { _key: child._key } : {}), text: child.text, marks: childMarks as string[] }
        : undefined;
    });
    if (safeChildren.some((child) => !child)) return undefined;
    if (block._key !== undefined && (!text(block._key) || !/^[A-Za-z0-9_-]{1,80}$/.test(block._key))) return undefined;
    return {
      _type: "block",
      ...(text(block._key) ? { _key: block._key } : {}),
      style: style as string,
      ...(block.listItem !== undefined ? { listItem: block.listItem as string, ...(Number.isSafeInteger(block.level) ? { level: block.level as number } : {}) } : {}),
      children: safeChildren,
      markDefs: safeMarks,
    };
  });
  return projected.every(Boolean) ? projected as Record<string, unknown>[] : undefined;
}

function keyedTexts(value: unknown, minimum = 1): CmsKeyedText[] | undefined {
  const items = list(value);
  if (!items || items.length < minimum) return undefined;
  const output = items.map((value) => record(value));
  if (output.some((item) => !text(item?.key) || !/^[a-z][a-z0-9_-]{1,39}$/.test(item.key) || !text(item?.text) || item.text.length > 500)) return undefined;
  const keys = output.map((item) => item!.key as string);
  if (new Set(keys).size !== keys.length) return undefined;
  return output.map((item) => ({ key: item!.key as string, text: item!.text as string }));
}

function sources(value: unknown): CmsSource[] | undefined {
  const items = list(value);
  if (!items?.length) return undefined;
  const output = items.map((input) => record(input));
  if (output.some((item) => !text(item?.key) || !/^[a-z][a-zA-Z0-9_-]{0,39}$/.test(item.key) || !text(item?.title) || item.title.length > 120 || !isHttpUrl(item?.url) || !validDate(item?.accessedAt))) return undefined;
  const keys = output.map((item) => item!.key as string);
  if (new Set(keys).size !== keys.length) return undefined;
  return output.map((item) => ({ key: item!.key as string, title: item!.title as string, url: item!.url as string, accessedAt: item!.accessedAt as string }));
}

function sourceKeys(value: unknown, known: ReadonlySet<string>, requireOne: boolean): string[] | undefined {
  const keys = list(value);
  if (!keys || (requireOne && keys.length === 0) || !keys.every((key) => text(key) && known.has(key)) || new Set(keys).size !== keys.length) return undefined;
  return keys as string[];
}

export function projectPublicPageSections(
  value: unknown,
  pageKey: string,
  productIds: ReadonlySet<string>,
  categoryIds: ReadonlySet<string>,
  comparisonIds: ReadonlySet<string>,
): Record<string, unknown>[] | undefined {
  const input = list(value);
  if (!input || input.length === 0 || input.length > 8) return undefined;
  const keys = input.map((section) => record(section)?.sectionKey);
  if (!keys.every((key) => text(key) && /^[a-z][a-z0-9_-]{1,39}$/.test(key)) || new Set(keys).size !== keys.length) return undefined;
  const sections = input.map((sectionInput) => {
    const section = record(sectionInput);
    if (!section || !text(section.sectionKey) || !text(section._type)) return undefined;
    const base = { _type: section._type, ...(text(section._key) ? { _key: section._key } : {}), sectionKey: section.sectionKey };
    if (section._type === "heroSection") {
      const body = portableText(section.body); const categoryId = ref(section.primaryCategory);
      return text(section.heading) && body && categoryId && categoryIds.has(categoryId)
        ? { ...base, heading: section.heading, body, primaryCategory: { _ref: categoryId }, ...(text(section.secondaryRequestLabel) ? { secondaryRequestLabel: section.secondaryRequestLabel } : {}) }
        : undefined;
    }
    if (section._type === "categoryLinksSection") {
      const ids = refs(section.categoryIds);
      return text(section.heading) && ids?.length && ids.every((id) => categoryIds.has(id)) ? { ...base, heading: section.heading, categoryIds: ids } : undefined;
    }
    if (section._type === "featuredProductsSection") {
      const ids = refs(section.productIds);
      return text(section.heading) && ids && ids.length >= 1 && ids.length <= 8 && ids.every((id) => productIds.has(id)) ? { ...base, heading: section.heading, productIds: ids } : undefined;
    }
    if (section._type === "featuredComparisonsSection") {
      const ids = refs(section.comparisonIds);
      return text(section.heading) && ids && ids.length >= 1 && ids.length <= 5 && ids.every((id) => comparisonIds.has(id)) ? { ...base, heading: section.heading, comparisonIds: ids } : undefined;
    }
    if (section._type === "methodologyTeaserSection") {
      const body = portableText(section.body);
      return text(section.heading) && body ? { ...base, heading: section.heading, body } : undefined;
    }
    if (section._type === "richTextSection") {
      const body = portableText(section.body);
      return body ? { ...base, ...(text(section.heading) ? { heading: section.heading } : {}), body } : undefined;
    }
    if (section._type === "aiScoreExample") {
      return pageKey === "aiMethodology" && section.methodologyVersion === "cms-ai-support-v1" && ["bundled", "external", "none"].includes(String(section.typesKind)) && typeof section.llmsTxtPresent === "boolean" && typeof section.mcpPresent === "boolean"
        ? { ...base, methodologyVersion: section.methodologyVersion, typesKind: section.typesKind, llmsTxtPresent: section.llmsTxtPresent, mcpPresent: section.mcpPresent }
        : undefined;
    }
    return undefined;
  });
  if (sections.some((section) => !section)) return undefined;
  const complete = sections as Record<string, unknown>[];
  if (pageKey === "home" && (complete[0]?._type !== "heroSection" || complete.filter((section) => section._type === "heroSection").length !== 1 || complete.some((section) => ["richTextSection", "aiScoreExample"].includes(String(section._type))))) return undefined;
  if (pageKey !== "home" && complete.some((section) => section._type !== "richTextSection" && !(pageKey === "aiMethodology" && section._type === "aiScoreExample"))) return undefined;
  return complete;
}

function fixtureModel(): CmsPublicReadModel {
  return {
    catalog: fixturePublishedCatalog,
    products: fixturePublishedCatalog.products.map(({ product, content, packages, repositories }) => ({
      product: {
        id: product.id, displayName: product.displayName, routeSlug: product.routeSlug,
        categoryIds: product.categoryIds, officialWebsiteUrl: "https://example.invalid/fixture/",
        officialDocsUrl: "https://example.invalid/fixture/docs/", hostingModels: [], apiStyles: [],
        packageIds: product.packageIds, repositoryIds: product.repositoryIds,
        ...(product.primaryPackageId ? { primaryPackageId: product.primaryPackageId } : {}),
        ...(product.primaryRepositoryId ? { primaryRepositoryId: product.primaryRepositoryId } : {}),
      },
      content: {
        summary: content.summary, useCases: [], fitsWhen: [], avoidWhen: [], limitations: [],
        integrationNotes: [], criteriaBlocks: [], sources: [], alternativeIds: [],
        reviewedAt: "2026-01-01T00:00:00Z", seo: { title: product.displayName, description: content.summary },
        ...(content.noPackageReason ? { noPackageReason: content.noPackageReason } : {}),
      },
      packages: packages.map((item) => ({ id: item.id, packageName: item.packageName, role: item.role, officialSourceUrl: item.officialSourceUrl })),
      repositories: repositories.map((item) => ({ id: item.id, owner: item.owner, name: item.name, scope: item.scope, role: item.role, officialSourceUrl: item.officialSourceUrl, ...(item.packageId ? { packageId: item.packageId } : {}) })),
    })),
    categories: [], comparisons: [], pages: [], redirects: [],
  };
}

function projectAiReview(input: RecordValue): AiReviewProjection | undefined {
  const product = ref(input.productId);
  const signalsInput = list(input.signals);
  const signalKeys = ["types", "llmsTxt", "mcp"] as const;
  if (!product || input._id !== `ai_review.${product}` || !text(input.mappingKey) || !text(input.methodologyVersion) || !text(input.reviewerLabel) || !validDate(input.reviewedAt) || !signalsInput || signalsInput.length !== 3) return undefined;
  const signals = signalsInput.map((signalInput, index): AiSignal | undefined => {
    const signal = record(signalInput); const key = signal?.key; const evidenceInputs = list(signal?.evidence);
    if (!signal || key !== signalKeys[index] || !["present", "absent", "unknown", "error", "not_applicable"].includes(String(signal.state)) || !text(signal.scope) || !(signal.checkedAt === null || validDate(signal.checkedAt)) || !evidenceInputs) return undefined;
    const evidence = evidenceInputs.map((evidenceInput) => {
      const item = record(evidenceInput); const entryPoints = item?.entryPoints === undefined ? undefined : list(item.entryPoints);
      return item && isHttpUrl(item.sourceUrl) && text(item.finding) && validDate(item.checkedAt) &&
        (item.officialSourceUrl === undefined || isHttpUrl(item.officialSourceUrl)) &&
        (item.packageVersion === undefined || text(item.packageVersion)) &&
        (item.entryPoints === undefined || (entryPoints && entryPoints.every(text)))
        ? { sourceUrl: item.sourceUrl, finding: item.finding, checkedAt: item.checkedAt as UtcDateTime,
          ...(item.officialSourceUrl !== undefined ? { officialSourceUrl: item.officialSourceUrl as string } : {}),
          ...(item.packageVersion !== undefined ? { packageVersion: item.packageVersion as string } : {}),
          ...(entryPoints ? { entryPoints: entryPoints as string[] } : {}) }
        : undefined;
    });
    if (evidence.some((item) => !item)) return undefined;
    if (key === "types" && signal.kind !== undefined && signal.kind !== null && !["bundled", "external", "none"].includes(String(signal.kind))) return undefined;
    if (key !== "types" && signal.kind !== undefined) return undefined;
    return {
      key: key as AiSignal["key"],
      state: signal.state as AiSignal["state"],
      scope: signal.scope,
      checkedAt: signal.checkedAt as UtcDateTime | null,
      evidence: evidence as NonNullable<AiSignal["evidence"]>,
      ...(key === "types" && signal.kind !== undefined ? { kind: signal.kind as AiSignal["kind"] } : {}),
    };
  });
  if (signals.some((signal) => !signal)) return undefined;
  return {
    id: input._id as string,
    productId: productId(product),
    mappingKey: input.mappingKey as string,
    methodologyVersion: input.methodologyVersion as string,
    reviewerLabel: input.reviewerLabel as string,
    signals: signals as [AiSignal, AiSignal, AiSignal],
    reviewedAt: input.reviewedAt as UtcDateTime,
    state: "published",
  };
}

/** Projects only complete, published documents; drafts and direct-API incomplete records stay invisible. */
export async function projectPublishedCmsRead(query: Query): Promise<CmsPublicReadModel> {
  const raw = record(await query(PUBLISHED_CMS_QUERY));
  if (!raw) throw new Error("Invalid CMS response.");
  const arrayFields = ["categories", "categoryContent", "products", "packages", "repositories", "productContent", "comparisons", "comparisonContent", "aiReviews", "pages", "redirects"];
  if (arrayFields.some((key) => !Array.isArray(raw[key])) || !Object.prototype.hasOwnProperty.call(raw, "siteSettings")) throw new Error("Invalid CMS response.");
  const categoryDocuments = list(raw.categories)!;
  const categoryContentDocuments = list(raw.categoryContent)!;
  const productDocuments = list(raw.products)!;
  const packageDocuments = list(raw.packages)!;
  const repositoryDocuments = list(raw.repositories)!;
  const productContentDocuments = list(raw.productContent)!;
  const comparisonDocuments = list(raw.comparisons)!;
  const comparisonContentDocuments = list(raw.comparisonContent)!;
  const aiReviewDocuments = list(raw.aiReviews)!;

  const categoryEntities = new Map<string, { id: string; routeSlug: string; displayOrder: number }>();
  for (const input of categoryDocuments) {
    const item = record(input); const id = item?._id; const slug = validSlug(item?.routeSlug); const order = item?.displayOrder;
    if (typeof id === "string" && /^cat_[a-z0-9_]+$/.test(id) && slug && typeof order === "number" && Number.isSafeInteger(order) && order >= 0) categoryEntities.set(id, { id, routeSlug: slug, displayOrder: order });
  }
  const categoryById = new Map<string, CmsPublicCategory>();
  for (const input of categoryDocuments) {
    const item = record(input); const id = item?._id; const slug = validSlug(item?.routeSlug); const order = item?.displayOrder;
    const content = categoryContentDocuments.map(record).find((candidate) => ref(candidate?.categoryId) === id && candidate?.locale === "en");
    const title = content?.title; const intro = portableText(content?.intro); const seo = validSeo(content?.seo);
    if (typeof id !== "string" || !categoryEntities.has(id) || !slug || !Number.isSafeInteger(order) || typeof order !== "number" || !text(title) || !intro || !seo) continue;
    categoryById.set(id, { id, routeSlug: slug, displayOrder: order, content: { title, intro, seo } });
  }

  const packageById = new Map<string, RecordValue>();
  for (const input of packageDocuments) { const item = record(input); if (typeof item?._id === "string") packageById.set(item._id, item); }
  const repositoryById = new Map<string, RecordValue>();
  for (const input of repositoryDocuments) { const item = record(input); if (typeof item?._id === "string") repositoryById.set(item._id, item); }
  const productById = new Map<string, RecordValue>();
  for (const input of productDocuments) { const item = record(input); if (typeof item?._id === "string") productById.set(item._id, item); }
  const contentByProductId = new Map<string, RecordValue>();
  for (const input of productContentDocuments) { const item = record(input); const id = ref(item?.productId); if (item && id && item.locale === "en" && !contentByProductId.has(id)) contentByProductId.set(id, item); }

  const products: CmsPublicProduct[] = [];
  const productIdSet = new Set<string>();
  for (const [id, item] of productById) {
    const routeSlug = validSlug(item.routeSlug); const categoryIds = refs(item.categoryIds);
    const packageIds = refs(item.packageIds); const repositoryIds = refs(item.repositoryIds);
    const content = contentByProductId.get(id);
    if (!/^prd_[a-z0-9_]+$/.test(id) || !text(item.displayName) || !routeSlug || !categoryIds?.length || !categoryIds.every((categoryId) => categoryEntities.has(categoryId)) || !packageIds || !repositoryIds || !isHttpUrl(item.officialWebsiteUrl) || !isHttpUrl(item.officialDocsUrl)) continue;
    if (list(item.hostingModels)?.some((v) => !["cloud", "self_hosted"].includes(String(v))) || list(item.apiStyles)?.some((v) => !["rest", "graphql"].includes(String(v)))) continue;
    const primaryPackageId = ref(item.primaryPackageId); const primaryRepositoryId = ref(item.primaryRepositoryId);
    if ((primaryPackageId && !packageIds.includes(primaryPackageId)) || (primaryRepositoryId && !repositoryIds.includes(primaryRepositoryId))) continue;
    const pkgDocs = packageIds.map((pkgId) => packageById.get(pkgId));
    const repoDocs = repositoryIds.map((repoId) => repositoryById.get(repoId));
    if (pkgDocs.some((pkg) => !pkg || !/^pkg_[a-z0-9_]+$/.test(pkg._id as string) || ref(pkg.productId) !== id || !text(pkg.packageName) || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(pkg.packageName) || !["primary_js_sdk", "additional"].includes(String(pkg.role)) || !isHttpUrl(pkg.officialSourceUrl))) continue;
    if (repoDocs.some((repo) => !repo || !/^repo_[a-z0-9_]+$/.test(repo._id as string) || ref(repo.productId) !== id || !text(repo.owner) || !text(repo.name) || !["product", "package"].includes(String(repo.scope)) || !["primary", "additional"].includes(String(repo.role)) || !isHttpUrl(repo.officialSourceUrl) || (repo.scope === "package" && (!ref(repo.packageId) || !packageIds.includes(ref(repo.packageId)!))))) continue;
    if ((primaryPackageId && !pkgDocs.some((pkg) => pkg?._id === primaryPackageId && pkg.role === "primary_js_sdk")) || (primaryRepositoryId && !repoDocs.some((repo) => repo?._id === primaryRepositoryId && repo.role === "primary"))) continue;
    if (!content || !text(content.summary) || content.summary.length > 500 || !validDate(content.reviewedAt) || content.locale !== "en") continue;
    const useCases = keyedTexts(content.useCases); const fitsWhen = keyedTexts(content.fitsWhen); const avoidWhen = keyedTexts(content.avoidWhen); const limitations = keyedTexts(content.limitations);
    const integrationNotes = portableText(content.integrationNotes); const contentSources = sources(content.sources); const seo = validSeo(content.seo);
    const sourceSet = new Set(contentSources?.map(({ key }) => key) ?? []);
    const criteriaInputs = list(content.criteriaBlocks);
    const criteria = criteriaInputs?.map((criterionInput) => {
      const criterion = record(criterionInput); const body = portableText(criterion?.body); const keys = sourceKeys(criterion?.sourceKeys, sourceSet, true);
      return text(criterion?.key) && body && keys ? { key: criterion.key, body, sourceKeys: keys } : undefined;
    });
    const expectedCriteria = ["deployment", "content_model", "editorial_workflow", "js_ts", "localization_access", "cost_limits", "agent_support"];
    if (!useCases || !fitsWhen || !avoidWhen || !limitations || !integrationNotes || !contentSources || !seo || !criteria || criteria.some((x) => !x) || criteria.length !== expectedCriteria.length || new Set(criteria.map((x) => x?.key)).size !== criteria.length || expectedCriteria.some((key) => !criteria.some((x) => x?.key === key))) continue;
    const completeCriteria = criteria.filter((criterion): criterion is NonNullable<typeof criterion> => Boolean(criterion));
    const alternativeIds = refs(content.alternativeIds);
    if (!alternativeIds || (primaryPackageId === undefined && !text(content.noPackageReason)) || (primaryPackageId !== undefined && content.noPackageReason !== undefined && !text(content.noPackageReason))) continue;
    if (contentSources.some((source) => !sourceSet.has(source.key))) continue;
    if (criteria.some((criterion) => criterion!.sourceKeys.some((key) => !sourceSet.has(key)))) continue;
    const domainProduct = {
      id: productId(id), displayName: item.displayName, routeSlug, categoryIds, packageIds, repositoryIds,
      ...(primaryPackageId ? { primaryPackageId } : {}), ...(primaryRepositoryId ? { primaryRepositoryId } : {}), state: "published" as const,
    };
    const selectedPackages = pkgDocs as RecordValue[];
    const selectedRepositories = repoDocs as RecordValue[];
    products.push({
      product: { ...domainProduct, officialWebsiteUrl: item.officialWebsiteUrl as string, officialDocsUrl: item.officialDocsUrl as string, hostingModels: (list(item.hostingModels) ?? []) as string[], apiStyles: (list(item.apiStyles) ?? []) as string[] },
      content: { summary: content.summary, useCases, fitsWhen, avoidWhen, limitations, integrationNotes, criteriaBlocks: completeCriteria, sources: contentSources, alternativeIds, reviewedAt: content.reviewedAt, seo, ...(text(content.noPackageReason) ? { noPackageReason: content.noPackageReason } : {}) },
      packages: selectedPackages.map((pkg) => ({ id: pkg._id as string, packageName: pkg.packageName as string, role: pkg.role as string, officialSourceUrl: pkg.officialSourceUrl as string })),
      repositories: selectedRepositories.map((repo) => ({ id: repo._id as string, owner: repo.owner as string, name: repo.name as string, scope: repo.scope as string, role: repo.role as string, officialSourceUrl: repo.officialSourceUrl as string, ...(ref(repo.packageId) ? { packageId: ref(repo.packageId)! } : {}) })),
    });
    productIdSet.add(id);
  }

  const reviewDocuments = aiReviewDocuments.map((input) => record(input)).filter((item): item is RecordValue => Boolean(item));
  const comparisons: CmsPublicComparison[] = [];
  const comparisonById = new Map<string, RecordValue>();
  for (const input of comparisonDocuments) { const item = record(input); if (typeof item?._id === "string") comparisonById.set(item._id, item); }
  for (const [id, item] of comparisonById) {
    const ids = refs(item.productIds); const categoryId = ref(item.categoryId); const displayOrder = refs(item.displayOrder);
    if (!/^cmp_[a-z0-9_]+$/.test(id) || !ids || ids.length !== 2 || ids[0] >= ids[1] || !categoryId || !categoryEntities.has(categoryId) || !displayOrder || displayOrder.length !== 2 || new Set(displayOrder).size !== 2 || !displayOrder.every((product) => ids.includes(product))) continue;
    let expectedPairKey: string;
    try { expectedPairKey = pairKey([productId(ids[0]), productId(ids[1])]); } catch { continue; }
    if (item.pairKey !== expectedPairKey || !ids.every((product) => productIdSet.has(product)) || ids.some((productIdValue) => !products.find(({ product }) => product.id === productIdValue)?.product.categoryIds.includes(categoryId))) continue;
    const localized = comparisonContentDocuments.map(record).find((candidate) => ref(candidate?.comparisonId) === id && candidate?.locale === "en");
    if (!localized || !text(localized.title) || localized.title.length > 160 || !validDate(localized.reviewedAt)) continue;
    const taskContext = portableText(localized.taskContext); const verdict = portableText(localized.verdict); const limitations = keyedTexts(localized.limitations); const sourceList = sources(localized.sources); const seo = validSeo(localized.seo);
    const knownSources = new Set(sourceList?.map(({ key }) => key) ?? []);
    const criterionInputs = list(localized.criteria);
    const criteria = criterionInputs?.map((criterionInput) => {
      const criterion = record(criterionInput); const cells = list(criterion?.cells);
      if (!text(criterion?.key) || !text(criterion.label) || !cells || cells.length !== 2) return undefined;
      const parsedCells = cells.map((cellInput) => {
        const cell = record(cellInput); const product = ref(cell?.productId); const keys = sourceKeys(cell?.sourceKeys, knownSources, true);
        return product && ids.includes(product) && text(cell?.text) && cell.text.length <= 1200 && keys ? { productId: productId(product), text: cell.text, sourceKeys: keys } : undefined;
      });
      if (parsedCells.some((cell) => !cell) || new Set(parsedCells.map((cell) => cell?.productId)).size !== 2 || !parsedCells.every((cell) => cell && sourceKeys(cell.sourceKeys, knownSources, true))) return undefined;
      return { key: criterion.key, label: criterion.label, ...(text(criterion.description) ? { description: criterion.description } : {}), cells: parsedCells as NonNullable<typeof parsedCells[number]>[], ...(text(criterion.importanceNote) ? { importanceNote: criterion.importanceNote } : {}) };
    });
    const choicesInput = list(localized.choiceGuidance);
    const choices = choicesInput?.map((choiceInput) => {
      const choice = record(choiceInput); const product = ref(choice?.productId); const conditions = keyedTexts(choice?.conditions);
      return product && ids.includes(product) && conditions ? { productId: productId(product), conditions } : undefined;
    });
    const sanities = ids.some((productIdValue) => products.find(({ product }) => product.id === productIdValue)?.product.routeSlug === "sanity");
    if (!taskContext || !verdict || !limitations || !sourceList || !seo || !criteria || criteria.length < 3 || criteria.some((criterion) => !criterion) || !choices || choices.length !== 2 || choices.some((choice) => !choice) || new Set(choices.map((choice) => choice?.productId)).size !== 2 || choices.some((choice) => !ids.includes(choice!.productId)) || ![true, false].includes(localized.indexingRequested as boolean) || (sanities && !text(localized.disclosure))) continue;
    const completeCriteria = criteria.filter((criterion): criterion is NonNullable<typeof criterion> => Boolean(criterion));
    const completeChoices = choices.filter((choice): choice is NonNullable<typeof choice> => Boolean(choice));
    comparisons.push({
      comparison: { id, productIds: [productId(ids[0]), productId(ids[1])], pairKey: expectedPairKey, categoryId, displayOrder },
      content: { title: localized.title, taskContext, criteria: completeCriteria, choiceGuidance: completeChoices, limitations, verdict, sources: sourceList, reviewedAt: localized.reviewedAt, seo, indexingRequested: localized.indexingRequested as boolean, ...(text(localized.disclosure) ? { disclosure: localized.disclosure } : {}) },
    });
  }

  const pages = (list(raw.pages) ?? []).map(record).flatMap((item) => {
    const pageKey = item?.pageKey; const title = item?.title; const seo = validSeo(item?.seo);
    if (!item || !["home", "aiMethodology", "privacy"].includes(String(pageKey)) || !text(title) || title.length > 120 || !seo) return [];
    const sections = projectPublicPageSections(item.sections, String(pageKey), productIdSet, new Set(categoryById.keys()), new Set(comparisons.map(({ comparison }) => comparison.id)));
    return sections ? [{ pageKey: pageKey as CmsPublicPage["pageKey"], title, sections, seo }] : [];
  });

  const siteSettingsDoc = record(raw.siteSettings);
  const navItems = list(siteSettingsDoc?.navigation)?.map(record);
  const footerRefs = refs(siteSettingsDoc?.footerLinks);
  const siteSettings = text(siteSettingsDoc?.siteName) && siteSettingsDoc.defaultLocale === "en" && JSON.stringify(siteSettingsDoc.activeLocales) === JSON.stringify(["en"]) && navItems && navItems.length > 0 && navItems.every((nav) => {
    const type = nav?.targetType;
    return text(nav?.key) && text(nav?.label) && (type === "requestShortlist" || type === "aiMethodology" || (type === "category" && Boolean(ref(nav.categoryId) && categoryById.has(ref(nav.categoryId)!))));
  }) && footerRefs && footerRefs.every((pageRef) => pages.some((page) => `page.${page.pageKey}.en` === pageRef))
    ? { siteName: siteSettingsDoc.siteName, navigation: navItems as Record<string, unknown>[], footerPageKeys: footerRefs.map((pageRef) => pageRef.split(".")[1] ?? "") }
    : undefined;

  const publishedPaths = new Set<string>(["/en/", "/en/request-shortlist/", "/en/methodology/ai-readiness/", "/en/privacy/"]);
  for (const category of categoryById.values()) publishedPaths.add(`/en/categories/${category.routeSlug}/`);
  for (const { product } of products) publishedPaths.add(`/en/tools/${product.routeSlug}/`);
  for (const { comparison: { productIds } } of comparisons) {
    const slugs = productIds.map((product) => products.find(({ product: item }) => item.id === product)?.product.routeSlug);
    if (slugs[0] && slugs[1]) publishedPaths.add(`/en/compare/${slugs[0]}-vs-${slugs[1]}/`);
  }
  const redirectCandidates = (list(raw.redirects) ?? []).map(record).filter((item): item is RecordValue => Boolean(item));
  const redirectCounts = new Map<string, number>();
  for (const item of redirectCandidates) if (text(item.sourcePath)) redirectCounts.set(item.sourcePath, (redirectCounts.get(item.sourcePath) ?? 0) + 1);
  const redirects = redirectCandidates.flatMap((item) => {
    if (!text(item.sourcePath) || !text(item.targetPath) || item.sourcePath === item.targetPath || item.statusCode !== 308 || !/^\/[a-z0-9/-]+\/$/.test(item.sourcePath) || !/^\/[a-z0-9/-]+\/$/.test(item.targetPath) || redirectCounts.get(item.sourcePath) !== 1 || !publishedPaths.has(item.targetPath) || redirectCandidates.some((other) => other.sourcePath === item.targetPath)) return [];
    return [{ sourcePath: item.sourcePath, targetPath: item.targetPath, createdAt: validDate(item.createdAt) ? item.createdAt : "", reason: text(item.reason) ? item.reason : "" }];
  });

  const domainPackages = products.flatMap(({ product: owner, packages: items }) => items.map((pkg) => ({
    id: packageId(pkg.id), productId: owner.id, packageName: pkg.packageName,
    role: pkg.role as "primary_js_sdk" | "additional", officialSourceUrl: pkg.officialSourceUrl,
  })));
  const domainRepositories = products.flatMap(({ product: owner, repositories: items }) => items.map((repo) => ({
    id: repositoryId(repo.id), productId: owner.id, owner: repo.owner, name: repo.name,
    scope: repo.scope as "product" | "package", role: repo.role as "primary" | "additional",
    officialSourceUrl: repo.officialSourceUrl, ...(repo.packageId ? { packageId: packageId(repo.packageId) } : {}),
  })));
  const domainReviews = reviewDocuments.flatMap((review) => {
    const projected = projectAiReview(review);
    return projected && productIdSet.has(projected.productId) ? [projected] : [];
  });
  const catalogSnapshot: CatalogSnapshot = {
    products: products.map(({ product }) => ({
      id: product.id, displayName: product.displayName, routeSlug: product.routeSlug,
      categoryIds: product.categoryIds.map(categoryId), packageIds: product.packageIds.map(packageId),
      repositoryIds: product.repositoryIds.map(repositoryId),
      ...(product.primaryPackageId ? { primaryPackageId: packageId(product.primaryPackageId) } : {}),
      ...(product.primaryRepositoryId ? { primaryRepositoryId: repositoryId(product.primaryRepositoryId) } : {}),
      state: "published" as const,
    })),
    productContent: products.map(({ product, content }) => ({ documentId: `content.product.${product.id}.en`, productId: product.id, locale: "en" as const, state: "published" as const, summary: content.summary, ...(content.noPackageReason ? { noPackageReason: content.noPackageReason } : {}) })),
    packages: domainPackages,
    repositories: domainRepositories,
    comparisons: comparisons.map(({ comparison }) => ({
      id: comparisonId(comparison.id), productIds: comparison.productIds,
      pairKey: pairKey(comparison.productIds), categoryId: categoryId(comparison.categoryId), state: "published" as const,
    })),
    comparisonContent: comparisons.map(({ comparison, content }) => ({ documentId: `content.comparison.${comparison.id}.en`, comparisonId: comparisonId(comparison.id), locale: "en" as const, state: "published" as const, title: content.title })),
    aiReviews: domainReviews,
  };
  const catalog = toPublishedCatalog(catalogSnapshot);
  return { catalog, products, categories: [...categoryById.values()], comparisons, pages, ...(siteSettings ? { siteSettings } : {}), redirects };
}

async function queryLive(projectId: string, dataset: string, apiVersion: string): Promise<CmsPublicReadModel> {
  const client = createClient({ projectId, dataset, apiVersion, useCdn: false, perspective: "published" });
  return projectPublishedCmsRead((groq) => client.fetch(groq, {}, { timeout: LIVE_READ_TIMEOUT_MS }));
}

const cachedQueryLive = unstable_cache(
  async (projectId: string, dataset: string, apiVersion: string) => queryLive(projectId, dataset, apiVersion),
  ["pkgcompass-published-cms-v1"],
  { revalidate: CACHE_SECONDS, tags: [CACHE_TAG] },
);

export async function getPublishedCatalogRead(): Promise<CmsReadResult> {
  const target = selectComponentTarget("content");
  if (target.mode === "fixture") return { status: 200, source: "fixture", model: fixtureModel() };
  try {
    const model = await cachedQueryLive(target.settings.SANITY_PROJECT_ID, target.settings.SANITY_DATASET, target.settings.SANITY_API_VERSION);
    return { status: 200, source: "live", model };
  } catch {
    return { status: 503, code: "cms_unavailable" };
  }
}

export async function getPublishedCatalogStatus(): Promise<200 | 503> {
  const result = await getPublishedCatalogRead();
  return result.status;
}

/** Content-only adapter for existing FP-03 consumers; it shares the same cache and allowlist. */
export async function getPublishedContentRepository() {
  const result = await getPublishedCatalogRead();
  return {
    async getPublishedCatalog() {
      return result.status === 200
        ? { ok: true as const, value: result.model.catalog }
        : { ok: false as const, code: result.code };
    },
  };
}

export async function getPublishedProductBySlug(slug: string): Promise<CmsPublicProduct | undefined> {
  const result = await getPublishedCatalogRead();
  return result.status === 200 ? result.model.products.find(({ product }) => product.routeSlug === slug) : undefined;
}

export async function getPublishedComparisonByProductSlugs(firstSlug: string, secondSlug: string): Promise<CmsPublicComparison | undefined> {
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return undefined;
  const first = result.model.products.find(({ product }) => product.routeSlug === firstSlug)?.product.id;
  const second = result.model.products.find(({ product }) => product.routeSlug === secondSlug)?.product.id;
  if (!first || !second || first === second) return undefined;
  const key = pairKey([first, second]);
  return result.model.comparisons.find(({ comparison }) => comparison.pairKey === key);
}

export async function getPublishedComparisonRouteContext(slug: string): Promise<
  | { readonly kind: "unavailable" }
  | { readonly kind: "missing" }
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "published"; readonly comparison: CmsPublicComparison }
> {
  const result = await getPublishedCatalogRead();
  if (result.status !== 200) return { kind: "unavailable" };
  const pair = slug.endsWith("/") ? slug.slice(0, -1) : slug;
  const productSlugs = pair.split("-vs-");
  if (productSlugs.length !== 2 || productSlugs.some((part) => !part)) return { kind: "missing" };
  const [firstSlug, secondSlug] = productSlugs;
  const products = result.model.products;
  const first = products.find(({ product }) => product.routeSlug === firstSlug)?.product;
  const second = products.find(({ product }) => product.routeSlug === secondSlug)?.product;
  if (!first || !second || first.id === second.id) return { kind: "missing" };
  const canonicalSlugs = [first, second].sort((a, b) => a.id.localeCompare(b.id)).map(({ routeSlug }) => routeSlug);
  const canonicalPairSlug = `${canonicalSlugs[0]}-vs-${canonicalSlugs[1]}`;
  if (pair !== canonicalPairSlug) return { kind: "redirect", location: `/en/compare/${canonicalPairSlug}/` };
  const comparison = result.model.comparisons.find(({ comparison }) => comparison.pairKey === pairKey([first.id, second.id]));
  return comparison ? { kind: "published", comparison } : { kind: "missing" };
}

export { CACHE_TAG as PUBLISHED_CMS_CACHE_TAG, CACHE_SECONDS as PUBLISHED_CMS_CACHE_SECONDS };
