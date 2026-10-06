import { defineArrayMember, defineField, defineType } from "sanity";
import { isCurrentUtcDateTime, isNonEmptyText, uniqueReferences } from "./helpers";

const referenceField = (name: string, title: string, target: string, required = true) => defineField({
  name,
  title,
  type: "reference",
  to: [{ type: target }],
  validation: (rule) => required ? rule.required() : rule,
});

const sectionKey = defineField({ name: "sectionKey", title: "Stable section key", type: "string", validation: (rule) => rule.required().regex(/^[a-z][a-z0-9_-]{1,39}$/) });
const heading = defineField({ name: "heading", title: "Heading", type: "string", validation: (rule) => rule.required().max(120) });
const body = defineField({ name: "body", title: "Text", type: "portableText", validation: (rule) => rule.required() });
const uniqueReferenceArray = (name: string, title: string, target: string, min = 1) => defineField({
  name,
  title,
  type: "array",
  of: [defineArrayMember({ type: "reference", to: [{ type: target }] })],
  validation: (rule) => rule.required().min(min).unique().custom((value) => uniqueReferences(value)),
});

export const heroSectionType = defineType({
  name: "heroSection",
  title: "Hero",
  type: "object",
  fields: [
    sectionKey,
    heading,
    body,
    defineField({ name: "primaryCategory", title: "Primary category link", type: "reference", to: [{ type: "category" }], validation: (rule) => rule.required() }),
    defineField({ name: "secondaryRequestLabel", title: "Optional request link label", type: "string", validation: (rule) => rule.max(60) }),
  ],
});

export const categoryLinksSectionType = defineType({
  name: "categoryLinksSection",
  title: "Category links",
  type: "object",
  fields: [sectionKey, heading, uniqueReferenceArray("categoryIds", "Categories", "category")],
});

export const featuredProductsSectionType = defineType({
  name: "featuredProductsSection",
  title: "Featured CMS products",
  type: "object",
  fields: [sectionKey, heading, uniqueReferenceArray("productIds", "Products", "product")],
  validation: (rule) => rule.custom((value) => {
    const productIds = (value as { productIds?: unknown[] })?.productIds ?? [];
    return productIds.length <= 8 ? true : { message: "Feature no more than eight products.", path: ["productIds"] };
  }),
});

export const featuredComparisonsSectionType = defineType({
  name: "featuredComparisonsSection",
  title: "Featured comparisons",
  type: "object",
  fields: [sectionKey, heading, uniqueReferenceArray("comparisonIds", "Comparisons", "comparison")],
  validation: (rule) => rule.custom((value) => {
    const ids = (value as { comparisonIds?: unknown[] })?.comparisonIds ?? [];
    return ids.length <= 5 ? true : { message: "Feature no more than five comparisons.", path: ["comparisonIds"] };
  }),
});

export const methodologyTeaserSectionType = defineType({
  name: "methodologyTeaserSection",
  title: "AI readiness methodology teaser",
  type: "object",
  fields: [sectionKey, heading, body],
});

export const richTextSectionType = defineType({
  name: "richTextSection",
  title: "Editorial text section",
  type: "object",
  fields: [
    sectionKey,
    defineField({ name: "heading", title: "Heading", type: "string", validation: (rule) => rule.max(120) }),
    body,
  ],
});

export const aiScoreExampleType = defineType({
  name: "aiScoreExample",
  title: "AI readiness score example",
  type: "object",
  fields: [
    sectionKey,
    defineField({ name: "methodologyVersion", title: "Methodology version", type: "string", validation: (rule) => rule.required().custom((value) => value === "cms-ai-support-v1" || "Use the active methodology version.") }),
    defineField({ name: "typesKind", title: "Types signal", type: "string", options: { list: [
      { title: "Bundled types", value: "bundled" },
      { title: "External types", value: "external" },
      { title: "No types", value: "none" },
    ] }, validation: (rule) => rule.required() }),
    defineField({ name: "llmsTxtPresent", title: "Official llms.txt exists", type: "boolean", validation: (rule) => rule.required() }),
    defineField({ name: "mcpPresent", title: "Official MCP exists", type: "boolean", validation: (rule) => rule.required() }),
  ],
  preview: {
    select: { typesKind: "typesKind", llmsTxtPresent: "llmsTxtPresent", mcpPresent: "mcpPresent" },
    prepare({ typesKind, llmsTxtPresent, mcpPresent }) {
      return { title: "Calculated AI score example", subtitle: `${typesKind ?? "incomplete"} types; llms.txt ${llmsTxtPresent ? "present" : "absent"}; MCP ${mcpPresent ? "present" : "absent"}` };
    },
  },
});

export const pageSectionTypes = [
  heroSectionType,
  categoryLinksSectionType,
  featuredProductsSectionType,
  featuredComparisonsSectionType,
  methodologyTeaserSectionType,
  richTextSectionType,
  aiScoreExampleType,
] as const;

export const pageType = defineType({
  name: "page",
  title: "Site page",
  type: "document",
  fields: [
    defineField({ name: "pageKey", title: "Page", type: "string", options: { list: [
      { title: "Home", value: "home" },
      { title: "AI readiness methodology", value: "aiMethodology" },
      { title: "Privacy", value: "privacy" },
    ] }, validation: (rule) => rule.required() }),
    defineField({ name: "locale", title: "Locale", type: "string", initialValue: "en", options: { list: [{ title: "English", value: "en" }] }, validation: (rule) => rule.required().custom((value) => value === "en" || "Only English content is enabled in v1.") }),
    defineField({ name: "title", title: "Page title", type: "string", validation: (rule) => rule.required().max(120) }),
    defineField({ name: "sections", title: "Page sections", type: "array", of: pageSectionTypes.map(({ name }) => defineArrayMember({ type: name })), validation: (rule) => rule.required().min(1).max(8).custom((value, context) => {
      const pageKey = (context.document as { pageKey?: unknown } | undefined)?.pageKey;
      const sections = Array.isArray(value) ? value as { _type?: string; sectionKey?: unknown; heading?: unknown; body?: unknown; categoryIds?: unknown[]; productIds?: unknown[]; comparisonIds?: unknown[] }[] : [];
      const keys = sections.map((section) => section.sectionKey);
      if (keys.some((key) => typeof key !== "string" || key.trim().length === 0) || new Set(keys).size !== keys.length) {
        return "Each section needs a unique stable key.";
      }
      if (pageKey === "home") {
        const heroes = sections.filter(({ _type }) => _type === "heroSection");
        if (heroes.length !== 1 || sections[0]?._type !== "heroSection") {
          return "Home requires exactly one hero section in the first position.";
        }
        if (sections.some(({ _type }) => _type === "richTextSection" || _type === "aiScoreExample")) {
          return "Home uses only the six approved home section types.";
        }
        if (sections.some((section) => section._type === "featuredProductsSection" && (section.productIds?.length ?? 0) > 8)) {
          return "Home may feature at most eight products.";
        }
        if (sections.some((section) => section._type === "featuredComparisonsSection" && (section.comparisonIds?.length ?? 0) > 5)) {
          return "Home may feature at most five comparisons.";
        }
      } else if (sections.some(({ _type }) => _type !== "richTextSection" && !(pageKey === "aiMethodology" && _type === "aiScoreExample"))) {
        return "Methodology and privacy pages use rich text; methodology may also include a score example.";
      }
      return true;
    }) }),
    defineField({ name: "seo", title: "SEO and sharing text", type: "seo", validation: (rule) => rule.required() }),
  ],
});

export const siteNavigationItemType = defineType({
  name: "siteNavigationItem",
  title: "Navigation link",
  type: "object",
  fields: [
    defineField({ name: "key", title: "Stable key", type: "string", validation: (rule) => rule.required().regex(/^[a-z][a-z0-9_-]{1,39}$/) }),
    defineField({ name: "label", title: "Label", type: "string", validation: (rule) => rule.required().max(60) }),
    defineField({ name: "targetType", title: "Target type", type: "string", options: { list: [
      { title: "CMS category", value: "category" },
      { title: "Request a shortlist", value: "requestShortlist" },
      { title: "AI methodology", value: "aiMethodology" },
    ] }, validation: (rule) => rule.required() }),
    defineField({ name: "categoryId", title: "Category target", type: "reference", to: [{ type: "category" }], hidden: ({ parent }) => parent?.targetType !== "category" }),
  ],
  validation: (rule) => rule.custom((value) => {
    const item = value as { targetType?: unknown; categoryId?: unknown };
    return (item.targetType !== "category" || Boolean(item.categoryId)) &&
      (item.targetType === "category" || !item.categoryId)
      ? true
      : "Choose exactly the target required by the navigation type.";
  }),
});

export const siteSettingsType = defineType({
  name: "siteSettings",
  title: "Site settings",
  type: "document",
  fields: [
    defineField({ name: "siteName", title: "Site name", type: "string", validation: (rule) => rule.required().max(80) }),
    defineField({ name: "defaultLocale", title: "Default locale", type: "string", initialValue: "en", options: { list: [{ title: "English", value: "en" }] }, validation: (rule) => rule.required().custom((value) => value === "en" || "Only English is enabled in v1.") }),
    defineField({ name: "activeLocales", title: "Active locales", type: "array", of: [defineArrayMember({ type: "string", options: { list: [{ title: "English", value: "en" }] } })], initialValue: ["en"], validation: (rule) => rule.required().length(1).custom((value) => Array.isArray(value) && value.length === 1 && value[0] === "en" || "English is the only active locale in v1.") }),
    defineField({ name: "navigation", title: "Main navigation", type: "array", of: [defineArrayMember({ type: "siteNavigationItem" })], validation: (rule) => rule.required().min(1).custom((value) => {
      const keys = Array.isArray(value) ? value.map((item) => (item as { key?: unknown })?.key) : [];
      return keys.every(isNonEmptyText) && new Set(keys).size === keys.length || "Navigation keys must be present and unique.";
    }) }),
    defineField({ name: "footerLinks", title: "Footer pages", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "page" }] })], validation: (rule) => rule.required().unique().custom((value) => uniqueReferences(value)) }),
  ],
});

export const redirectType = defineType({
  name: "redirect",
  title: "Permanent redirect",
  type: "document",
  fields: [
    defineField({ name: "sourcePath", title: "Old path", type: "string", validation: (rule) => rule.required().regex(/^\/[a-z0-9/-]+\/$/) }),
    defineField({ name: "targetPath", title: "Current internal path", type: "string", validation: (rule) => rule.required().regex(/^\/[a-z0-9/-]+\/$/) }),
    defineField({ name: "statusCode", title: "Status", type: "number", initialValue: 308, readOnly: true, validation: (rule) => rule.required().custom((value) => value === 308 || "Redirects use status 308.") }),
    defineField({ name: "createdAt", title: "Created at (UTC)", type: "datetime", validation: (rule) => rule.required() }),
    defineField({ name: "reason", title: "Reason", type: "string", validation: (rule) => rule.required().max(240) }),
  ],
  validation: (rule) => rule.custom((value) => {
    const redirect = value as { sourcePath?: unknown; targetPath?: unknown };
    return typeof redirect.sourcePath === "string" && redirect.sourcePath === redirect.targetPath
      ? { message: "A redirect cannot point to itself.", path: ["targetPath"] }
      : true;
  }),
});

export const aiReviewType = defineType({
  name: "aiReview",
  title: "AI support review",
  type: "document",
  fields: [
    referenceField("productId", "CMS product", "product"),
    defineField({ name: "mappingKey", title: "Calculated mapping key", type: "string", readOnly: true, validation: (rule) => rule.required() }),
    defineField({ name: "methodologyVersion", title: "Methodology version", type: "string", initialValue: "cms-ai-support-v1", readOnly: true, validation: (rule) => rule.required().custom((value) => value === "cms-ai-support-v1" || "Use cms-ai-support-v1.") }),
    defineField({ name: "signals", title: "Three review signals", type: "array", of: [defineArrayMember({ type: "aiSignal" })], validation: (rule) => rule.required().length(3).custom((value) => {
      const keys = Array.isArray(value) ? value.map((signal) => (signal as { key?: unknown }).key) : [];
      return JSON.stringify(keys) === JSON.stringify(["types", "llmsTxt", "mcp"])
        ? true
        : "Signals must appear exactly once in types, llmsTxt, mcp order.";
    }) }),
    defineField({ name: "reviewedAt", title: "Reviewed at (UTC)", type: "datetime", validation: (rule) => rule.required().custom(isCurrentUtcDateTime) }),
    defineField({ name: "reviewerLabel", title: "Reviewer label", type: "string", validation: (rule) => rule.required().max(80) }),
    defineField({ name: "overrideReason", title: "Correction reason", type: "text", rows: 2, validation: (rule) => rule.max(500) }),
    defineField({ name: "previousFinding", title: "Previous finding", type: "text", rows: 2, validation: (rule) => rule.max(800) }),
  ],
});

export const siteDocumentTypes = [
  pageType,
  siteSettingsType,
  redirectType,
  aiReviewType,
] as const;
