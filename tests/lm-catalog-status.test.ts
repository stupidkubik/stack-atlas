import { describe, expect, it } from "vitest";
import { catalogStatusProjection } from "../src/server/catalog/status";

describe("catalog status runtime attestation", () => {
  it("exposes only availability and the resolved public environment", () => {
    expect(catalogStatusProjection("development", 200)).toEqual({
      available: true,
      environment: "development",
    });
    expect(catalogStatusProjection("development", 503)).toEqual({
      available: false,
      environment: "development",
    });
    expect(Object.keys(catalogStatusProjection("production", 503)).sort()).toEqual([
      "available",
      "environment",
    ]);
  });
});
