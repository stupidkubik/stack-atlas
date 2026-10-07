import { describe, expect, it } from "vitest";
import { packageId, productId, repositoryId } from "../src/domain/ids";
import { parseMetricObservation } from "../src/domain/data-contracts";
import { computeMappingKey } from "../src/domain/mapping-key";
import { utcDateTime } from "../src/domain/utc";

describe("mapping key", () => {
  const base = {
    productId: productId("prd_example"),
    primaryPackage: { id: packageId("pkg_example"), packageName: "@scope/sdk" },
    primaryRepository: { id: repositoryId("repo_example"), owner: "vendor", name: "cms" },
    sdkPackageVersion: "2.4.0",
  } as const;

  it("is stable for the same semantic mapping and changes with source identity or SDK version", async () => {
    const key = await computeMappingKey(base);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await computeMappingKey({ ...base })).toBe(key);
    expect(await computeMappingKey({ ...base, primaryPackage: { ...base.primaryPackage, packageName: "@scope/renamed" } })).not.toBe(key);
    expect(await computeMappingKey({ ...base, primaryRepository: { ...base.primaryRepository, name: "new-repo" } })).not.toBe(key);
    expect(await computeMappingKey({ ...base, sdkPackageVersion: "2.4.1" })).not.toBe(key);
  });

  it("represents a CMS without an SDK without inventing a source", async () => {
    expect(await computeMappingKey({
      productId: productId("prd_without_sdk"),
      primaryPackage: null,
      primaryRepository: null,
      sdkPackageVersion: null,
    })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("metric observation contracts", () => {
  const now = new Date("2026-10-06T08:00:00.000Z");
  const base = {
    productId: productId("prd_example"),
    source: "npm",
    metric: "downloads_30d",
    sourceEntityId: packageId("pkg_example"),
    sourceIdentity: "@scope/sdk",
    sourceUrl: "https://www.npmjs.com/package/%40scope%2Fsdk",
    status: "ok",
    reason: null,
    value: 0,
    observedAt: utcDateTime("2026-10-05T00:00:00.000Z"),
    fetchedAt: utcDateTime("2026-10-06T08:00:00.000Z"),
    periodStart: "2026-09-05",
    periodEnd: "2026-10-04",
    dailySeries: Array.from({ length: 30 }, (_, offset) => ({
      day: new Date(Date.parse("2026-09-05T00:00:00.000Z") + offset * 24 * 60 * 60_000).toISOString().slice(0, 10),
      downloads: 0,
    })),
  } as const;

  it("preserves a true zero and rejects invalid timestamps and unsafe source URLs", () => {
    expect(parseMetricObservation(base, now)?.value).toBe(0);
    expect(parseMetricObservation({ ...base, observedAt: "2026-10-06T08:06:00.000Z" }, now)).toBeUndefined();
    expect(parseMetricObservation({ ...base, sourceUrl: "https://user:pass@example.test/path" }, now)).toBeUndefined();
  });

  it("keeps unknown distinct from a negative value and rejects duplicate days", () => {
    expect(parseMetricObservation({
      ...base,
      status: "unknown",
      reason: "incomplete_period",
      value: null,
      observedAt: null,
      dailySeries: null,
    }, now)?.status).toBe("unknown");
    expect(parseMetricObservation({
      ...base,
      dailySeries: [{ day: "2026-09-05", downloads: 0 }, { day: "2026-09-05", downloads: 1 }],
    }, now)).toBeUndefined();
    expect(parseMetricObservation({
      ...base,
      status: "error",
      reason: "source_timeout",
    }, now)).toBeUndefined();
  });
});
