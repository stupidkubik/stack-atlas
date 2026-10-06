import { defineArrayMember, defineField, defineType } from "sanity";
import { containsOnlyKnownSourceKeys, isHttpUrl, isNonEmptyText, portableTextHasContent, uniqueObjectKeys } from "./helpers";

export const seoType = defineType({
  name: "seo",
  title: "Search and sharing",
  type: "object",
  fields: [
    defineField({ name: "title", title: "Title", type: "string", validation: (rule) => rule.required().max(70) }),
    defineField({ name: "description", title: "Description", type: "text", rows: 3, validation: (rule) => rule.required().max(180) }),
  ],
});

export const sourceType = defineType({
  name: "source",
  title: "Source",
  type: "object",
  fields: [
    defineField({ name: "key", title: "Source key", type: "string", validation: (rule) => rule.required().regex(/^[a-z][a-zA-Z0-9_-]{0,39}$/) }),
    defineField({ name: "title", title: "Link label", type: "string", validation: (rule) => rule.required().max(120) }),
    defineField({ name: "url", title: "URL", type: "url", validation: (rule) => rule.required().uri({ scheme: ["http", "https"] }).custom((value) => isHttpUrl(value) || "Use an absolute HTTP(S) URL without credentials.") }),
    defineField({ name: "accessedAt", title: "Accessed at (UTC)", type: "datetime", validation: (rule) => rule.required() }),
  ],
});

export const safeLinkType = defineType({
  name: "safeLink",
  title: "Link",
  type: "object",
  fields: [
    defineField({ name: "href", title: "URL", type: "url", validation: (rule) => rule.required().uri({ scheme: ["http", "https"] }).custom((value) => isHttpUrl(value) || "Use an absolute HTTP(S) URL without credentials.") }),
  ],
});

export const portableTextType = defineType({
  name: "portableText",
  type: "array",
  of: [
    defineArrayMember({
      type: "block",
      styles: [
        { title: "Paragraph", value: "normal" },
        { title: "Heading 2", value: "h2" },
        { title: "Heading 3", value: "h3" },
      ],
      lists: [{ title: "Bullet", value: "bullet" }, { title: "Numbered", value: "number" }],
      marks: {
        decorators: [
          { title: "Strong", value: "strong" },
          { title: "Emphasis", value: "em" },
          { title: "Code", value: "code" },
        ],
        annotations: [defineArrayMember({ type: "safeLink" })],
      },
    }),
  ],
  validation: (rule) => rule.custom((value) => value === undefined || portableTextHasContent(value) || "Add at least one text block."),
});

export const sourceKeysType = defineType({
  name: "sourceKeys",
  title: "Supporting source keys",
  type: "array",
  of: [defineArrayMember({ type: "string" })],
  validation: (rule) => rule.unique().custom((value, context) => containsOnlyKnownSourceKeys(value, context)),
});

export const keyedTextType = defineType({
  name: "keyedText",
  title: "Editorial note",
  type: "object",
  fields: [
    defineField({ name: "key", title: "Stable key", type: "string", validation: (rule) => rule.required().regex(/^[a-z][a-z0-9_-]{1,39}$/) }),
    defineField({ name: "text", title: "Text", type: "text", rows: 2, validation: (rule) => rule.required().max(500).custom((value) => isNonEmptyText(value) || "Add non-empty text.") }),
  ],
});

export const sourceListType = defineType({
  name: "sources",
  title: "Sources",
  type: "array",
  of: [defineArrayMember({ type: "source" })],
  validation: (rule) => rule.required().min(1).custom((value) => uniqueObjectKeys(value, "Sources")),
});

export const criteriaBlockType = defineType({
  name: "criteriaBlock",
  title: "Editorial criterion block",
  type: "object",
  fields: [
    defineField({ name: "key", title: "Criterion", type: "string", options: { list: [
      { title: "Deployment", value: "deployment" },
      { title: "Content model", value: "content_model" },
      { title: "Editorial workflow", value: "editorial_workflow" },
      { title: "JavaScript and TypeScript", value: "js_ts" },
      { title: "Localization and access", value: "localization_access" },
      { title: "Cost and limits", value: "cost_limits" },
      { title: "Agent support", value: "agent_support" },
    ] }, validation: (rule) => rule.required() }),
    defineField({ name: "body", title: "Evidence-based notes", type: "portableText", validation: (rule) => rule.required() }),
    defineField({ name: "sourceKeys", title: "Sources", type: "sourceKeys", validation: (rule) => rule.required().min(1) }),
  ],
});

export const evidenceType = defineType({
  name: "aiEvidence",
  title: "Evidence",
  type: "object",
  fields: [
    defineField({ name: "sourceUrl", title: "Evidence URL", type: "url", validation: (rule) => rule.required().uri({ scheme: ["http", "https"] }) }),
    defineField({ name: "officialSourceUrl", title: "Official CMS source", type: "url", validation: (rule) => rule.uri({ scheme: ["http", "https"] }) }),
    defineField({ name: "finding", title: "Finding", type: "text", rows: 3, validation: (rule) => rule.required().max(800) }),
    defineField({ name: "checkedAt", title: "Checked at (UTC)", type: "datetime", validation: (rule) => rule.required() }),
    defineField({ name: "packageVersion", title: "SDK version", type: "string" }),
    defineField({ name: "entryPoints", title: "Verified entry points", type: "array", of: [defineArrayMember({ type: "string" })], validation: (rule) => rule.unique() }),
  ],
});

export const aiSignalType = defineType({
  name: "aiSignal",
  title: "AI support signal",
  type: "object",
  fields: [
    defineField({ name: "key", title: "Signal", type: "string", options: { list: [
      { title: "SDK types", value: "types" },
      { title: "Official llms.txt", value: "llmsTxt" },
      { title: "Official MCP", value: "mcp" },
    ] }, validation: (rule) => rule.required() }),
    defineField({ name: "state", title: "Finding state", type: "string", options: { list: [
      { title: "Present", value: "present" },
      { title: "Absent", value: "absent" },
      { title: "Unknown", value: "unknown" },
      { title: "Error", value: "error" },
      { title: "Not applicable", value: "not_applicable" },
    ] }, validation: (rule) => rule.required() }),
    defineField({ name: "kind", title: "Type support", type: "string", options: { list: [
      { title: "Bundled", value: "bundled" },
      { title: "External @types", value: "external" },
      { title: "No types", value: "none" },
    ] }, hidden: ({ parent }) => parent?.key !== "types" }),
    defineField({ name: "checkedAt", title: "Checked at (UTC)", type: "datetime" }),
    defineField({ name: "scope", title: "Scope checked", type: "text", rows: 2, validation: (rule) => rule.required().max(400) }),
    defineField({ name: "reason", title: "Reason for unknown/error/not applicable", type: "text", rows: 2, validation: (rule) => rule.max(400) }),
    defineField({ name: "evidence", title: "Evidence", type: "array", of: [defineArrayMember({ type: "aiEvidence" })], validation: (rule) => rule.custom((value, context) => {
      const state = (context.parent as { state?: unknown } | undefined)?.state;
      return (state !== "present" && state !== "absent") || (Array.isArray(value) && value.length > 0)
        ? true
        : "Present and absent findings require at least one evidence item.";
    }) }),
  ],
  validation: (rule) => rule.custom((value) => {
    const signal = value as { key?: unknown; state?: unknown; kind?: unknown; checkedAt?: unknown; reason?: unknown };
    if (signal.key === "types" && ["present", "absent"].includes(String(signal.state)) && !["bundled", "external", "none"].includes(String(signal.kind))) {
      return { message: "A completed SDK types review must record bundled, external, or no types.", path: ["kind"] };
    }
    if (signal.key !== "types" && signal.kind !== undefined) {
      return { message: "Only the SDK types signal has a kind.", path: ["kind"] };
    }
    if (["unknown", "error", "not_applicable"].includes(String(signal.state)) && !isNonEmptyText(signal.reason)) {
      return { message: "Explain unknown, failed, or not-applicable findings.", path: ["reason"] };
    }
    if (["present", "absent"].includes(String(signal.state)) && !isNonEmptyText(signal.checkedAt)) {
      return { message: "A completed finding needs its check time.", path: ["checkedAt"] };
    }
    return true;
  }),
});

export const sourceAwareCriterionType = defineType({
  name: "comparisonCriterion",
  title: "Comparison criterion",
  type: "object",
  fields: [
    defineField({ name: "key", title: "Stable criterion key", type: "string", validation: (rule) => rule.required().regex(/^[a-z][a-z0-9_-]{1,39}$/) }),
    defineField({ name: "label", title: "Criterion", type: "string", validation: (rule) => rule.required().max(100) }),
    defineField({ name: "description", title: "Description", type: "text", rows: 2 }),
    defineField({ name: "cells", title: "Product findings", type: "array", of: [defineArrayMember({ type: "comparisonCell" })], validation: (rule) => rule.required().length(2) }),
    defineField({ name: "importanceNote", title: "Why this matters", type: "text", rows: 2 }),
  ],
});

export const comparisonCellType = defineType({
  name: "comparisonCell",
  title: "Product finding",
  type: "object",
  fields: [
    defineField({ name: "productId", title: "Product", type: "reference", to: [{ type: "product" }], validation: (rule) => rule.required() }),
    defineField({ name: "text", title: "Finding", type: "text", rows: 3, validation: (rule) => rule.required().max(1200).custom((value) => isNonEmptyText(value) || "Add a documented finding.") }),
    defineField({ name: "sourceKeys", title: "Supporting sources", type: "sourceKeys", validation: (rule) => rule.required() }),
  ],
});

export const choiceGuidanceType = defineType({
  name: "choiceGuidance",
  title: "When to choose",
  type: "object",
  fields: [
    defineField({ name: "productId", title: "Product", type: "reference", to: [{ type: "product" }], validation: (rule) => rule.required() }),
    defineField({ name: "conditions", title: "Conditions", type: "array", of: [defineArrayMember({ type: "keyedText" })], validation: (rule) => rule.required().min(1).custom((value) => uniqueObjectKeys(value, "Choice conditions")) }),
  ],
});
