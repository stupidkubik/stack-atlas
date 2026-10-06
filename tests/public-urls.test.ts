import { describe, expect, it } from "vitest";
import { absoluteCanonical, comparisonPath, productPath } from "../src/domain/public-urls";
import { productId } from "../src/domain/ids";

describe("public URL contract", () => {
  it("builds stable English paths and orders comparison columns by stable product ID", () => {
    expect(productPath("sanity")).toBe("/en/tools/sanity/");
    expect(comparisonPath([
      { id: productId("prd_b"), routeSlug: "second-cms" },
      { id: productId("prd_a"), routeSlug: "first-cms" },
    ])).toBe("/en/compare/first-cms-vs-second-cms/");
  });

  it("rejects ambiguous product slugs and unsafe canonical origins", () => {
    expect(() => productPath("one-vs-two")).toThrow("Invalid public route slug.");
    expect(() => absoluteCanonical("https://user:secret@example.com", "/en/"))
      .toThrow("Invalid canonical origin.");
  });

  it("resolves an allowed path against the configured origin", () => {
    expect(absoluteCanonical("https://pkgcompass.example/", "/en/"))
      .toBe("https://pkgcompass.example/en/");
  });
});
