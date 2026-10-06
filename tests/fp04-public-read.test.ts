import { describe, expect, it } from "vitest";
import { projectPublicPageSections } from "../src/server/sanity/public-read";

describe("published Sanity page projection", () => {
  it("removes editor-only section and Portable Text fields", () => {
    const projected = projectPublicPageSections([{
      _type: "heroSection",
      _key: "hero_1",
      sectionKey: "hero_main",
      heading: "Choose a CMS",
      body: [{
        _type: "block",
        _key: "block_1",
        style: "normal",
        children: [{ _type: "span", _key: "span_1", text: "Compare options", marks: [], editorComment: "private" }],
        markDefs: [],
        internalDraftMarker: "private",
      }],
      primaryCategory: { _ref: "cat_cms" },
      internalNotes: "private",
    }], "home", new Set(), new Set(["cat_cms"]), new Set());

    expect(projected).toEqual([{
      _type: "heroSection",
      _key: "hero_1",
      sectionKey: "hero_main",
      heading: "Choose a CMS",
      body: [{
        _type: "block",
        _key: "block_1",
        style: "normal",
        children: [{ _type: "span", _key: "span_1", text: "Compare options", marks: [] }],
        markDefs: [],
      }],
      primaryCategory: { _ref: "cat_cms" },
    }]);
  });

  it("rejects unsupported and unresolved references", () => {
    expect(projectPublicPageSections([{
      _type: "featuredProductsSection",
      sectionKey: "featured_products",
      heading: "Products",
      productIds: [{ _ref: "prd_unpublished" }],
      editorialPayload: "private",
    }], "home", new Set(), new Set(), new Set())).toBeUndefined();

    expect(projectPublicPageSections([{
      _type: "unknownEditorWidget",
      sectionKey: "unknown_widget",
      payload: "private",
    }], "privacy", new Set(), new Set(), new Set())).toBeUndefined();
  });
});
