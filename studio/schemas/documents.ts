import { defineArrayMember, defineField, defineType } from "sanity";
import { getReferenceId, isCurrentUtcDateTime, isHttpUrl, slugIsValid, uniqueObjectKeys, uniqueReferences } from "./helpers";

const requiredText = (name: string, title: string, max = 240) =>
  defineField({ name, title, type: "string", validation: (rule) => rule.required().max(max) });

const referenceField = (name: string, title: string, target: string, required = true) =>
  defineField({
    name,
    title,
    type: "reference",
    to: [{ type: target }],
    validation: (rule) => required ? rule.required() : rule,
  });

const referenceArray = (name: string, title: string, target: string, required = false) =>
  defineField({
    name,
    title,
    type: "array",
    of: [defineArrayMember({ type: "reference", to: [{ type: target }] })],
    validation: (rule) => required
      ? rule.required().min(1).unique().custom((value) => uniqueReferences(value))
      : rule.unique().custom((value) => uniqueReferences(value)),
  });

const localeField = defineField({
  name: "locale",
  title: "Locale",
  type: "string",
  initialValue: "en",
  options: { list: [{ title: "English", value: "en" }] },
  validation: (rule) => rule.required().custom((value) => value === "en" || "Only English content is enabled in v1."),
});

const slugField = (source: string) => defineField({
  name: "routeSlug",
  title: "Route slug",
  type: "slug",
  options: { source },
  validation: (rule) => rule.required().custom((value) => slugIsValid(value)),
});

const sources = defineField({ name: "sources", title: "Sources", type: "sources", validation: (rule) => rule.required().min(1) });
const seo = defineField({ name: "seo", title: "SEO and sharing text", type: "seo", validation: (rule) => rule.required() });

export const categoryType = defineType({
  name: "category",
  title: "Category",
  type: "document",
  fields: [
    defineField({ name: "routeSlug", title: "Route slug", type: "slug", options: {}, validation: (rule) => rule.required().custom((value) => slugIsValid(value)) }),
    defineField({ name: "displayOrder", title: "Display order", type: "number", validation: (rule) => rule.required().integer().min(0) }),
  ],
});

export const productType = defineType({
  name: "product",
  title: "CMS product",
  type: "document",
  fields: [
    requiredText("displayName", "CMS name", 100),
    slugField("displayName"),
    referenceArray("categoryIds", "Categories", "category", true),
    defineField({ name: "officialWebsiteUrl", title: "Official website", type: "url", validation: (rule) => rule.required().uri({ scheme: ["http", "https"] }).custom((value) => isHttpUrl(value) || "Use an absolute HTTP(S) URL without credentials.") }),
    defineField({ name: "officialDocsUrl", title: "Official documentation", type: "url", validation: (rule) => rule.required().uri({ scheme: ["http", "https"] }).custom((value) => isHttpUrl(value) || "Use an absolute HTTP(S) URL without credentials.") }),
    defineField({ name: "hostingModels", title: "Hosting models", type: "array", of: [defineArrayMember({ type: "string", options: { list: [
      { title: "Cloud", value: "cloud" },
      { title: "Self-hosted", value: "self_hosted" },
    ] } })], validation: (rule) => rule.unique() }),
    defineField({ name: "apiStyles", title: "API styles", type: "array", of: [defineArrayMember({ type: "string", options: { list: [
      { title: "REST", value: "rest" },
      { title: "GraphQL", value: "graphql" },
    ] } })], validation: (rule) => rule.unique() }),
    referenceArray("packageIds", "Packages", "package"),
    referenceArray("repositoryIds", "Repositories", "repository"),
    referenceField("primaryPackageId", "Primary JavaScript SDK", "package", false),
    referenceField("primaryRepositoryId", "Primary repository", "repository", false),
  ],
  validation: (rule) => rule.custom((value) => {
    const document = value as { packageIds?: unknown[]; repositoryIds?: unknown[]; primaryPackageId?: unknown; primaryRepositoryId?: unknown };
    const packageIds = (document.packageIds ?? []).map(getReferenceId);
    const repositoryIds = (document.repositoryIds ?? []).map(getReferenceId);
    if (document.primaryPackageId && !packageIds.includes(getReferenceId(document.primaryPackageId))) {
      return { message: "The primary SDK must appear in Packages.", path: ["primaryPackageId"] };
    }
    if (document.primaryRepositoryId && !repositoryIds.includes(getReferenceId(document.primaryRepositoryId))) {
      return { message: "The primary repository must appear in Repositories.", path: ["primaryRepositoryId"] };
    }
    return true;
  }),
});

export const packageType = defineType({
  name: "package",
  title: "JavaScript package",
  type: "document",
  fields: [
    referenceField("productId", "Product", "product"),
    defineField({ name: "packageName", title: "Exact npm package name", type: "string", validation: (rule) => rule.required().regex(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i) }),
    defineField({ name: "role", title: "Role", type: "string", options: { list: [
      { title: "Primary JavaScript SDK", value: "primary_js_sdk" },
      { title: "Additional", value: "additional" },
    ] }, validation: (rule) => rule.required() }),
    defineField({ name: "officialSourceUrl", title: "Official package source", type: "url", validation: (rule) => rule.required().uri({ scheme: ["http", "https"] }).custom((value) => isHttpUrl(value) || "Use an absolute HTTP(S) URL without credentials.") }),
  ],
});

export const repositoryType = defineType({
  name: "repository",
  title: "Source repository",
  type: "document",
  fields: [
    referenceField("productId", "Product", "product"),
    requiredText("owner", "Repository owner", 100),
    requiredText("name", "Repository name", 100),
    defineField({ name: "scope", title: "Scope", type: "string", options: { list: [
      { title: "Product", value: "product" },
      { title: "Package", value: "package" },
    ] }, validation: (rule) => rule.required() }),
    referenceField("packageId", "Package", "package", false),
    defineField({ name: "role", title: "Role", type: "string", options: { list: [
      { title: "Primary", value: "primary" },
      { title: "Additional", value: "additional" },
    ] }, validation: (rule) => rule.required() }),
    defineField({ name: "officialSourceUrl", title: "Official source URL", type: "url", validation: (rule) => rule.required().uri({ scheme: ["http", "https"] }).custom((value) => isHttpUrl(value) || "Use an absolute HTTP(S) URL without credentials.") }),
  ],
  validation: (rule) => rule.custom((value) => {
    const document = value as { scope?: unknown; packageId?: unknown };
    return document.scope !== "package" || Boolean(document.packageId)
      ? true
      : { message: "A package-scoped repository must name its package.", path: ["packageId"] };
  }),
});

export const productContentType = defineType({
  name: "productContent",
  title: "Product content (English)",
  type: "document",
  fields: [
    referenceField("productId", "Product", "product"),
    localeField,
    defineField({ name: "summary", title: "Summary", type: "text", rows: 3, validation: (rule) => rule.required().max(500) }),
    defineField({ name: "useCases", title: "Use cases", type: "array", of: [defineArrayMember({ type: "keyedText" })], validation: (rule) => rule.required().min(1).custom((value) => uniqueObjectKeys(value, "Use cases")) }),
    defineField({ name: "fitsWhen", title: "Fits when", type: "array", of: [defineArrayMember({ type: "keyedText" })], validation: (rule) => rule.required().min(1).custom((value) => uniqueObjectKeys(value, "Fit conditions")) }),
    defineField({ name: "avoidWhen", title: "Avoid when", type: "array", of: [defineArrayMember({ type: "keyedText" })], validation: (rule) => rule.required().min(1).custom((value) => uniqueObjectKeys(value, "Avoid conditions")) }),
    defineField({ name: "limitations", title: "Limitations", type: "array", of: [defineArrayMember({ type: "keyedText" })], validation: (rule) => rule.required().min(1).custom((value) => uniqueObjectKeys(value, "Limitations")) }),
    defineField({ name: "integrationNotes", title: "JavaScript and TypeScript integration", type: "portableText", validation: (rule) => rule.required() }),
    defineField({ name: "criteriaBlocks", title: "Seven comparison criteria", type: "array", of: [defineArrayMember({ type: "criteriaBlock" })], validation: (rule) => rule.required().length(7).custom((value) => {
      const requiredKeys = ["deployment", "content_model", "editorial_workflow", "js_ts", "localization_access", "cost_limits", "agent_support"];
      const keys = Array.isArray(value) ? value.map((item) => (item as { key?: unknown })?.key) : [];
      return keys.length === requiredKeys.length && requiredKeys.every((key) => keys.includes(key)) && new Set(keys).size === keys.length
        ? true
        : "Include each of the seven editorial criteria exactly once.";
    }) }),
    sources,
    referenceArray("alternativeIds", "Published alternatives", "product"),
    defineField({ name: "noPackageReason", title: "Reason no comparable npm package is selected", type: "text", rows: 2, validation: (rule) => rule.max(300) }),
    defineField({ name: "reviewedAt", title: "Editorially reviewed at (UTC)", type: "datetime", validation: (rule) => rule.required().custom(isCurrentUtcDateTime) }),
    seo,
  ],
  validation: (rule) => rule.custom((value) => {
    const content = value as { sources?: unknown; criteriaBlocks?: unknown };
    const keys = Array.isArray(content.sources) ? content.sources.map((source) => (source as { key?: unknown }).key) : [];
    const citedKeys = Array.isArray(content.criteriaBlocks) ? content.criteriaBlocks.flatMap((block) => {
      const item = block as { sourceKeys?: unknown };
      return Array.isArray(item.sourceKeys) ? item.sourceKeys : [];
    }) : [];
    return citedKeys.every((key) => keys.includes(key)) ? true : "Every cited source key must be present in Sources.";
  }),
});

export const categoryContentType = defineType({
  name: "categoryContent",
  title: "Category content (English)",
  type: "document",
  fields: [
    referenceField("categoryId", "Category", "category"),
    localeField,
    requiredText("title", "Title", 120),
    defineField({ name: "intro", title: "Introduction", type: "portableText", validation: (rule) => rule.required() }),
    seo,
  ],
});

export const comparisonType = defineType({
  name: "comparison",
  title: "Comparison identity",
  type: "document",
  fields: [
    defineField({ name: "productIds", title: "Products (canonical ID order)", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "product" }] })], validation: (rule) => rule.required().length(2).custom((value) => {
      if (!Array.isArray(value) || value.length !== 2) return "Choose exactly two different products.";
      const ids = value.map(getReferenceId);
      return ids.every(Boolean) && ids[0] !== ids[1] && ids[0]! < ids[1]!
        ? true
        : "Products must be distinct and ordered by stable ID.";
    }) }),
    defineField({ name: "pairKey", title: "Stable pair key", type: "string", readOnly: true, validation: (rule) => rule.required() }),
    referenceField("categoryId", "Category", "category"),
    defineField({ name: "displayOrder", title: "Column order", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "product" }] })], validation: (rule) => rule.required().length(2).custom((value, context) => {
      if (!Array.isArray(value) || value.length !== 2) return "Choose both comparison columns.";
      const ids = value.map(getReferenceId);
      const productIdValues = (context.document as { productIds?: unknown } | undefined)?.productIds;
      const documentIds = Array.isArray(productIdValues) ? productIdValues.map(getReferenceId) : [];
      return ids.every(Boolean) && new Set(ids).size === 2 && ids.every((id) => documentIds.includes(id))
        ? true
        : "Column order must contain each comparison product exactly once.";
    }) }),
  ],
});

export const comparisonContentType = defineType({
  name: "comparisonContent",
  title: "Comparison content (English)",
  type: "document",
  fields: [
    referenceField("comparisonId", "Comparison", "comparison"),
    localeField,
    requiredText("title", "Title", 160),
    defineField({ name: "taskContext", title: "Task and audience", type: "portableText", validation: (rule) => rule.required() }),
    defineField({ name: "criteria", title: "Comparison criteria", type: "array", of: [defineArrayMember({ type: "comparisonCriterion" })], validation: (rule) => rule.required().min(3).custom((value) => uniqueObjectKeys(value, "Comparison criteria")) }),
    defineField({ name: "choiceGuidance", title: "When to choose each product", type: "array", of: [defineArrayMember({ type: "choiceGuidance" })], validation: (rule) => rule.required().length(2) }),
    defineField({ name: "limitations", title: "Limitations", type: "array", of: [defineArrayMember({ type: "keyedText" })], validation: (rule) => rule.required().min(1).custom((value) => uniqueObjectKeys(value, "Limitations")) }),
    defineField({ name: "verdict", title: "Editorial verdict", type: "portableText", validation: (rule) => rule.required() }),
    sources,
    defineField({ name: "reviewedAt", title: "Editorially reviewed at (UTC)", type: "datetime", validation: (rule) => rule.required().custom(isCurrentUtcDateTime) }),
    seo,
    defineField({ name: "indexingRequested", title: "Request indexing", type: "boolean", initialValue: false, validation: (rule) => rule.required() }),
    defineField({ name: "disclosure", title: "Sanity disclosure", type: "text", rows: 3, validation: (rule) => rule.max(600) }),
  ],
  validation: (rule) => rule.custom((value) => {
    const content = value as { sources?: unknown; criteria?: unknown };
    const sourceKeys = Array.isArray(content.sources) ? content.sources.map((source) => (source as { key?: unknown }).key) : [];
    const criteria = Array.isArray(content.criteria) ? content.criteria : [];
    const missingSource = criteria.some((criterion) => {
      const row = criterion as { cells?: unknown[] };
      return !Array.isArray(row.cells) || row.cells.length !== 2 || row.cells.some((cell) => {
        const keys = (cell as { sourceKeys?: unknown })?.sourceKeys;
        return !Array.isArray(keys) || keys.length === 0 || keys.some((key) => !sourceKeys.includes(key));
      });
    });
    return missingSource ? "Every comparison cell must cite a source defined in this document." : true;
  }),
});

export const documentTypes = [
  categoryType,
  productType,
  packageType,
  repositoryType,
  productContentType,
  categoryContentType,
  comparisonType,
  comparisonContentType,
] as const;
