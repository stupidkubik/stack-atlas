import { readAiSdkVersion } from "../../src/domain/ai-review-version";
import { parsePublishedAiReview } from "../../src/domain/ai-readiness";
import { computeMappingKey } from "../../src/domain/mapping-key";
import { packageId, productId, repositoryId } from "../../src/domain/ids";
import { aiReviewDocumentId, categoryContentDocumentId, comparisonContentDocumentId, pageDocumentId, productContentDocumentId, siteSettingsDocumentId } from "../../src/domain/cms-document-ids";

type Doc = Record<string, unknown> & { _id: string; _type: string; _rev?: string };
type Fetcher = <Result = unknown>(query: string, params?: Record<string, unknown>) => Promise<Result>;

export interface PublicationValidation {
  readonly errors: readonly string[];
  readonly calculatedMappingKey?: string;
}

function ref(value: unknown): string | undefined {
  return value !== null && typeof value === "object" && typeof (value as { _ref?: unknown })._ref === "string"
    ? (value as { _ref: string })._ref
    : undefined;
}

function refs(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map(ref);
  return result.every((item): item is string => Boolean(item)) && new Set(result).size === result.length ? result : undefined;
}

function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function routeSlug(value: unknown): boolean {
  const current = value !== null && typeof value === "object" ? (value as { current?: unknown }).current : undefined;
  return typeof current === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(current) && !current.includes("-vs-");
}
function exactId(value: string, prefix: string): boolean { return new RegExp(`^${prefix}[a-z0-9_]+$`).test(value); }
function validTimestamp(value: unknown): boolean { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 300_000; }
function validUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
}
function uniqueKeys(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const keys = value.map((item) => (item as { key?: unknown } | null)?.key);
  return keys.length > 0 && keys.every((key) => text(key)) && new Set(keys).size === keys.length;
}
function validSourceList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((source) => {
    const item = source as Record<string, unknown>;
    return text(item.key) && text(item.title) && item.title.length <= 120 && validUrl(item.url) && validTimestamp(item.accessedAt);
  }) && uniqueKeys(value);
}
function citationKeysValid(sourceKeys: unknown, sourceList: unknown): boolean {
  if (!Array.isArray(sourceKeys) || !Array.isArray(sourceList) || sourceKeys.length === 0) return false;
  const known = new Set(sourceList.map((source) => (source as { key?: unknown })?.key));
  return sourceKeys.every((key) => text(key) && known.has(key)) && new Set(sourceKeys).size === sourceKeys.length;
}
function portableTextValid(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((item) => {
    const block = item as Record<string, unknown>;
    return block._type === "block" && Array.isArray(block.children) && block.children.some((span) => {
      const child = span as Record<string, unknown>;
      return child._type === "span" && text(child.text);
    });
  });
}

async function fetchDoc(fetch: Fetcher, id: string): Promise<Doc | undefined> {
  const result = await fetch<unknown>("*[_id == $id && !(_id in path(\"drafts.**\"))][0]", { id });
  return result !== null && typeof result === "object" && typeof (result as Doc)._id === "string" ? result as Doc : undefined;
}

async function fetchMany(fetch: Fetcher, query: string, params: Record<string, unknown> = {}): Promise<Doc[]> {
  const values = await fetch<unknown>(query, params);
  return Array.isArray(values) ? values.filter((item): item is Doc => item !== null && typeof item === "object" && typeof (item as Doc)._id === "string") : [];
}

function refId(value: unknown): string | undefined { return ref(value); }

async function validateProduct(doc: Doc, fetch: Fetcher, errors: string[]): Promise<void> {
  if (!exactId(doc._id, "prd_") || !text(doc.displayName) || doc.displayName.length > 100 || !routeSlug(doc.routeSlug)) errors.push("Use a stable product ID, name, and valid lowercase route slug.");
  const categoryIds = refs(doc.categoryIds); const packageIds = refs(doc.packageIds); const repositoryIds = refs(doc.repositoryIds);
  if (!categoryIds?.length || !packageIds || !repositoryIds || !validUrl(doc.officialWebsiteUrl) || !validUrl(doc.officialDocsUrl)) errors.push("Product requires a category, valid mappings, and official website/documentation URLs.");
  for (const id of categoryIds ?? []) if (!await fetchDoc(fetch, id)) errors.push("Every product category must already be published.");
  const packages = await fetchMany(fetch, "*[_type == \"package\" && _id in $ids]{_id,productId,role}", { ids: packageIds ?? [] });
  const repositories = await fetchMany(fetch, "*[_type == \"repository\" && _id in $ids]{_id,productId,role}", { ids: repositoryIds ?? [] });
  if ((packageIds ?? []).some((id) => !packages.some((item) => item._id === id && refId(item.productId) === doc._id))) errors.push("Every package mapping must be published and owned by this product.");
  if ((repositoryIds ?? []).some((id) => !repositories.some((item) => item._id === id && refId(item.productId) === doc._id))) errors.push("Every repository mapping must be published and owned by this product.");
  const primaryPackageId = refId(doc.primaryPackageId); const primaryRepositoryId = refId(doc.primaryRepositoryId);
  if (primaryPackageId && (!packageIds?.includes(primaryPackageId) || !packages.some((item) => item._id === primaryPackageId && item.role === "primary_js_sdk"))) errors.push("The primary SDK must be a published primary package included in this product's package list.");
  if (primaryRepositoryId && (!repositoryIds?.includes(primaryRepositoryId) || !repositories.some((item) => item._id === primaryRepositoryId && item.role === "primary"))) errors.push("The primary repository must be a published primary repository included in this product's repository list.");
  const duplicateSlug = await fetch<unknown>("count(*[_type == \"product\" && routeSlug.current == $slug && _id != $id])", { slug: (doc.routeSlug as { current?: string } | undefined)?.current ?? "", id: doc._id });
  if (typeof duplicateSlug === "number" && duplicateSlug > 0) errors.push("This product route slug is already in use.");
}

async function validateProductContent(doc: Doc, fetch: Fetcher, errors: string[]): Promise<void> {
  const productId = refId(doc.productId);
  const expectedId = productId && exactId(productId, "prd_") ? productContentDocumentId(productId) : undefined;
  if (!expectedId || doc._id !== expectedId || doc.locale !== "en") errors.push("Use the stable root-path content ID and the enabled English locale.");
  const product = productId ? await fetchDoc(fetch, productId) : undefined;
  if (!product) errors.push("Publish the common product before its English content.");
  if (!text(doc.summary) || doc.summary.length > 500 || !uniqueKeys(doc.useCases) || !uniqueKeys(doc.fitsWhen) || !uniqueKeys(doc.avoidWhen) || !uniqueKeys(doc.limitations) || !portableTextValid(doc.integrationNotes) || !validSourceList(doc.sources) || !validTimestamp(doc.reviewedAt)) errors.push("Product content needs complete editorial sections, sources, and a valid review date.");
  const expected = ["deployment", "content_model", "editorial_workflow", "js_ts", "localization_access", "cost_limits", "agent_support"];
  const blocks = Array.isArray(doc.criteriaBlocks) ? doc.criteriaBlocks as Record<string, unknown>[] : [];
  if (blocks.length !== 7 || expected.some((key) => !blocks.some((block) => block.key === key && portableTextValid(block.body) && citationKeysValid(block.sourceKeys, doc.sources)))) errors.push("Add each of the seven editorial criteria with sourced evidence.");
  if (product && !refId(product.primaryPackageId) && !text(doc.noPackageReason)) errors.push("Explain why there is no comparable primary JavaScript SDK.");
  if (product && refId(product.primaryPackageId) && text(doc.noPackageReason)) errors.push("Remove no-package reason while a primary SDK is mapped.");
}

async function validateComparison(doc: Doc, fetch: Fetcher, errors: string[]): Promise<void> {
  const productIds = refs(doc.productIds); const categoryId = refId(doc.categoryId); const order = refs(doc.displayOrder);
  if (!exactId(doc._id, "cmp_") || !productIds || productIds.length !== 2 || productIds[0] >= productIds[1] || !categoryId || !order || order.length !== 2 || new Set(order).size !== 2 || !order.every((id) => productIds.includes(id))) errors.push("Comparison requires two distinct products in stable ID order and a two-product display order.");
  if (productIds?.length === 2) {
    const products = await Promise.all(productIds.map((id) => fetchDoc(fetch, id)));
    if (products.some((item) => !item)) errors.push("Both comparison products must already be published.");
    if (categoryId && products.some((item) => !refs(item?.categoryIds)?.includes(categoryId))) errors.push("Both products must belong to the selected comparison category.");
    const duplicate = await fetch<unknown>("count(*[_type == \"comparison\" && pairKey == $key && _id != $id])", { key: JSON.stringify(productIds), id: doc._id });
    if (typeof duplicate === "number" && duplicate > 0) errors.push("A comparison for this product pair already exists.");
    if (doc.pairKey !== JSON.stringify(productIds)) errors.push("Pair key must equal the canonical JSON serialization of product IDs.");
  }
  if (categoryId && !await fetchDoc(fetch, categoryId)) errors.push("The comparison category must already be published.");
}

async function validateComparisonContent(doc: Doc, fetch: Fetcher, errors: string[]): Promise<void> {
  const comparisonId = refId(doc.comparisonId);
  const expectedId = comparisonId && exactId(comparisonId, "cmp_") ? comparisonContentDocumentId(comparisonId) : undefined;
  if (!expectedId || doc._id !== expectedId || doc.locale !== "en") errors.push("Use the stable root-path comparison-content ID and English locale.");
  const comparison = comparisonId ? await fetchDoc(fetch, comparisonId) : undefined;
  const productIds = refs(comparison?.productIds);
  if (!comparison || productIds?.length !== 2) errors.push("Publish the comparison identity first.");
  const criteria = Array.isArray(doc.criteria) ? doc.criteria as Record<string, unknown>[] : [];
  const sourcesValid = validSourceList(doc.sources);
  if (!portableTextValid(doc.taskContext) || !portableTextValid(doc.verdict) || criteria.length < 3 || !uniqueKeys(criteria) || !sourcesValid || !uniqueKeys(doc.limitations) || !validTimestamp(doc.reviewedAt)) errors.push("Comparison content requires context, three criteria, sourced findings, limitations, a verdict, and a review date.");
  const sources = doc.sources;
  if (criteria.some((criterion) => !Array.isArray(criterion.cells) || (criterion.cells as Record<string, unknown>[]).length !== 2 || !(criterion.cells as Record<string, unknown>[]).every((cell) => productIds?.includes(refId(cell.productId) ?? "") && text(cell.text) && citationKeysValid(cell.sourceKeys, sources)))) errors.push("Each criterion needs one cited finding for each comparison product.");
  const choices = Array.isArray(doc.choiceGuidance) ? doc.choiceGuidance as Record<string, unknown>[] : [];
  if (!productIds || choices.length !== 2 || new Set(choices.map((choice) => refId(choice.productId))).size !== 2 || !choices.every((choice) => productIds.includes(refId(choice.productId) ?? "") && uniqueKeys(choice.conditions))) errors.push("Choose conditions must cover each compared product exactly once.");
  if (productIds?.some((id) => id === "prd_sanity") && !text(doc.disclosure)) errors.push("Add the required editorial disclosure for a comparison involving this site’s CMS.");
}

async function validateLocalizedCategoryContent(doc: Doc, fetch: Fetcher, errors: string[]): Promise<void> {
  const id = refId(doc.categoryId);
  const expectedId = id && exactId(id, "cat_") ? categoryContentDocumentId(id) : undefined;
  if (!expectedId || doc._id !== expectedId || doc.locale !== "en") errors.push("Use the stable root-path category-content ID and English locale.");
  if (!id || !await fetchDoc(fetch, id)) errors.push("Publish the category identity before its English content.");
  if (!text(doc.title) || !portableTextValid(doc.intro) || !validSeo(doc.seo)) errors.push("Category content needs a title, introduction, and SEO text.");
}

function validSeo(value: unknown): boolean {
  const item = value as Record<string, unknown> | undefined;
  return Boolean(item && text(item.title) && item.title.length <= 70 && text(item.description) && item.description.length <= 180);
}

async function validatePage(doc: Doc, errors: string[]): Promise<void> {
  if (!text(doc.pageKey) || !["home", "aiMethodology", "privacy"].includes(doc.pageKey) || doc.locale !== "en" || doc._id !== pageDocumentId(String(doc.pageKey)) || !text(doc.title) || !validSeo(doc.seo)) errors.push("Use a stable root-path English page ID, supported page key, title, and SEO fields.");
  const sections = Array.isArray(doc.sections) ? doc.sections as Record<string, unknown>[] : [];
  if (sections.length < 1 || sections.length > 8 || !uniqueKeys(sections)) errors.push("Pages need one to eight sections with unique stable keys.");
  if (doc.pageKey === "home" && (sections[0]?._type !== "heroSection" || sections.filter((section) => section._type === "heroSection").length !== 1 || sections.some((section) => ["richTextSection", "aiScoreExample"].includes(String(section._type))))) errors.push("Home requires one first-position hero and only approved home sections.");
  if (doc.pageKey !== "home" && sections.some((section) => section._type !== "richTextSection" && !(doc.pageKey === "aiMethodology" && section._type === "aiScoreExample"))) errors.push("Methodology and privacy pages use rich text; only methodology may include a score example.");
}

async function validateAiReview(doc: Doc, fetch: Fetcher, errors: string[]): Promise<string | undefined> {
  const productIdRef = refId(doc.productId);
  const expectedId = productIdRef && exactId(productIdRef, "prd_") ? aiReviewDocumentId(productIdRef) : undefined;
  if (!expectedId || doc._id !== expectedId || doc.methodologyVersion !== "cms-ai-support-v1" || !validTimestamp(doc.reviewedAt) || !text(doc.reviewerLabel)) errors.push("Use the stable root-path AI-review ID, active methodology, reviewer label, and valid review date.");
  const product = productIdRef ? await fetchDoc(fetch, productIdRef) : undefined;
  if (!product) errors.push("Publish the product identity before its AI review.");
  const signals = Array.isArray(doc.signals) ? doc.signals as Record<string, unknown>[] : [];
  const expected = ["types", "llmsTxt", "mcp"];
  if (signals.length !== 3 || JSON.stringify(signals.map((signal) => signal.key)) !== JSON.stringify(expected)) errors.push("Record exactly the types, llmsTxt, and mcp signals in order.");
  if (signals.some((signal) => !["present", "absent", "unknown", "error", "not_applicable"].includes(String(signal.state)) || !text(signal.scope) || (["present", "absent"].includes(String(signal.state)) && !validTimestamp(signal.checkedAt)) || (["unknown", "error", "not_applicable"].includes(String(signal.state)) && !text(signal.reason)) || (["present", "absent"].includes(String(signal.state)) && (!Array.isArray(signal.evidence) || signal.evidence.length === 0)))) errors.push("Complete every AI-review signal with a state, scope, and supporting evidence or reason.");
  const packageIdRef = refId(product?.primaryPackageId); const repositoryIdRef = refId(product?.primaryRepositoryId);
  const pkg = packageIdRef ? await fetchDoc(fetch, packageIdRef) : undefined; const repo = repositoryIdRef ? await fetchDoc(fetch, repositoryIdRef) : undefined;
  const sdkPackageVersion = readAiSdkVersion(doc);
  if (sdkPackageVersion === undefined) {
    errors.push("Types evidence must declare one consistent SDK version.");
    return undefined;
  }
  if (signals.some((signal) => signal.key !== "types" && signal.state === "present" &&
    !(Array.isArray(signal.evidence) && signal.evidence.some((item) => validUrl((item as Record<string, unknown>)?.officialSourceUrl))))) {
    errors.push("Present llms.txt and MCP findings require an official CMS source; community evidence does not earn official credit.");
  }
  try {
    const calculated = await computeMappingKey({
      productId: productId(productIdRef ?? "prd_invalid"),
      primaryPackage: pkg && packageIdRef ? { id: packageId(packageIdRef), packageName: String(pkg.packageName ?? "") } : null,
      primaryRepository: repo && repositoryIdRef ? { id: repositoryId(repositoryIdRef), owner: String(repo.owner ?? ""), name: String(repo.name ?? "") } : null,
      sdkPackageVersion,
    });
    if (!parsePublishedAiReview({ ...doc, productId: productIdRef, mappingKey: calculated, state: "published",
      signals: signals.map((signal) => ({ ...signal, checkedAt: signal.checkedAt ?? null, evidence: signal.evidence ?? [] })),
    }, new Date())) errors.push("AI-review evidence, dates, signal states or types kind are invalid.");
    return calculated;
  } catch {
    errors.push("The current product package and repository mapping is invalid.");
    return undefined;
  }
}

export async function validatePublicationDraft(doc: Doc, fetch: Fetcher): Promise<PublicationValidation> {
  const errors: string[] = [];
  let calculatedMappingKey: string | undefined;
  switch (doc._type) {
    case "category":
      if (!exactId(doc._id, "cat_") || !routeSlug(doc.routeSlug) || !Number.isSafeInteger(doc.displayOrder) || Number(doc.displayOrder) < 0) errors.push("Category requires a stable ID, valid slug, and non-negative display order.");
      if (await fetch<unknown>("count(*[_type == \"category\" && routeSlug.current == $slug && _id != $id])", { slug: (doc.routeSlug as { current?: string } | undefined)?.current ?? "", id: doc._id }) as number > 0) errors.push("This category route slug is already in use.");
      break;
    case "product": await validateProduct(doc, fetch, errors); break;
    case "package": {
      const owner = refId(doc.productId);
      if (!exactId(doc._id, "pkg_") || !owner || !await fetchDoc(fetch, owner) || !text(doc.packageName) || !validUrl(doc.officialSourceUrl) || !["primary_js_sdk", "additional"].includes(String(doc.role))) errors.push("Package mapping requires a published owner product, exact package name, role, and official source URL.");
      const existing = await fetch<unknown>("count(*[_type == \"package\" && packageName == $name && _id != $id])", { name: doc.packageName ?? "", id: doc._id });
      if (typeof existing === "number" && existing > 0) errors.push("This exact package name is already assigned.");
      break;
    }
    case "repository": {
      const owner = refId(doc.productId); const packageRef = refId(doc.packageId);
      if (!exactId(doc._id, "repo_") || !owner || !await fetchDoc(fetch, owner) || !text(doc.owner) || !text(doc.name) || !validUrl(doc.officialSourceUrl) || !["product", "package"].includes(String(doc.scope)) || !["primary", "additional"].includes(String(doc.role)) || (doc.scope === "package" && !packageRef)) errors.push("Repository mapping requires a published owner product, official source, scope, and role.");
      if (packageRef) { const pkg = await fetchDoc(fetch, packageRef); if (!pkg || refId(pkg.productId) !== owner) errors.push("Package-scoped repository must reference a published package of the same product."); }
      break;
    }
    case "productContent": await validateProductContent(doc, fetch, errors); break;
    case "categoryContent": await validateLocalizedCategoryContent(doc, fetch, errors); break;
    case "comparison": await validateComparison(doc, fetch, errors); break;
    case "comparisonContent": await validateComparisonContent(doc, fetch, errors); break;
    case "page": await validatePage(doc, errors); break;
    case "aiReview": calculatedMappingKey = await validateAiReview(doc, fetch, errors); break;
    case "siteSettings": {
      const navigation = Array.isArray(doc.navigation) ? doc.navigation as Record<string, unknown>[] : [];
      const pageIds = refs(doc.footerLinks);
      if (doc._id !== siteSettingsDocumentId() || !text(doc.siteName) || doc.defaultLocale !== "en" || JSON.stringify(doc.activeLocales) !== JSON.stringify(["en"]) || !uniqueKeys(navigation) || !pageIds?.length) errors.push("Site settings require the stable root-path ID, English locale, unique navigation items, and published footer pages.");
      for (const pageId of pageIds ?? []) if (!await fetchDoc(fetch, pageId)) errors.push("Every footer destination must be a published page.");
      break;
    }
    case "redirect": {
      const source = doc.sourcePath; const target = doc.targetPath;
      if (!text(source) || !text(target) || source === target || doc.statusCode !== 308 || !/^\/[a-z0-9/-]+\/$/.test(source) || !/^\/[a-z0-9/-]+\/$/.test(target) || !validTimestamp(doc.createdAt) || !text(doc.reason)) errors.push("Redirect requires different safe internal paths, status 308, creation date, and reason.");
      const duplicate = await fetch<unknown>("count(*[_type == \"redirect\" && sourcePath == $source && _id != $id])", { source: source ?? "", id: doc._id });
      const chain = await fetch<unknown>("count(*[_type == \"redirect\" && sourcePath == $target && _id != $id])", { target: target ?? "", id: doc._id });
      if (typeof duplicate === "number" && duplicate > 0) errors.push("This old route already has a redirect.");
      if (typeof chain === "number" && chain > 0) errors.push("Redirect targets must point directly to a current route.");
      break;
    }
    default:
      errors.push("This document type has no controlled publication rules.");
  }
  return { errors: [...new Set(errors)], ...(calculatedMappingKey ? { calculatedMappingKey } : {}) };
}
