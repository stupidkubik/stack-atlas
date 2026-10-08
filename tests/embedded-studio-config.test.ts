import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readEmbeddedStudioSettings } from "../src/server/sanity/embedded-studio";
import { selectComponentTarget } from "../src/server/config/targets";
import { createStudioConfig } from "../studio/config";
import { EmbeddedStudio } from "../src/app/studio/[[...tool]]/embedded-studio";

vi.mock("next-sanity/studio", () => ({
  NextStudio: ({ config }: { config: { basePath?: string } }) => createElement("div", { "data-studio-base-path": config.basePath ?? "/" }),
}));

const development = {
  APP_ENV: "development", SANITY_PROJECT_ID: "fixture-public-id", SANITY_DATASET: "development", SANITY_API_VERSION: "2026-10-01",
  SITE_URL: "http://127.0.0.1:3000",
  SANITY_PREVIEW_READ_TOKEN: "synthetic-private-preview-token",
  SANITY_SEED_WRITE_TOKEN: "synthetic-private-publisher-token",
  SANITY_WEBHOOK_SECRET: "synthetic-private-webhook-secret",
  DATABASE_LEAD_URL: "synthetic-private-database-credential",
  SANITY_STUDIO_PROJECT_ID: "different-cli-project",
  SANITY_STUDIO_DATASET: "production",
};
afterEach(() => vi.unstubAllEnvs());

describe("embedded Studio public target configuration", () => {
  it("mounts embedded tool navigation at /studio while the standalone Studio retains its root base path", () => {
    const settings = readEmbeddedStudioSettings(development)!;
    const html = renderToStaticMarkup(createElement(EmbeddedStudio, settings));
    expect(html).toContain('data-studio-base-path="/studio"');
    expect(createStudioConfig(settings)).not.toHaveProperty("basePath");
  });

  it("matches the validated content target and serializes only public identities and origin", () => {
    const target = selectComponentTarget("content", development);
    expect(target.mode).toBe("live");
    const settings = readEmbeddedStudioSettings(development);
    expect(settings).toEqual({ projectId: development.SANITY_PROJECT_ID, dataset: "development", previewOrigin: development.SITE_URL });
    expect(Object.keys(settings!).sort()).toEqual(["dataset", "previewOrigin", "projectId"]);
    expect(JSON.stringify(settings)).not.toContain("synthetic-private");
    expect(JSON.stringify(settings)).not.toContain("different-cli-project");
  });

  it("uses the trusted exact deployment origin for embedded preview instead of an inherited local address", () => {
    expect(readEmbeddedStudioSettings({ ...development, VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "owner-snapshot.vercel.app" }))
      .toEqual({ projectId: development.SANITY_PROJECT_ID, dataset: "development", previewOrigin: "https://owner-snapshot.vercel.app" });
  });

  it("does not construct a live Studio from fixture or untrusted PR credentials", () => {
    expect(readEmbeddedStudioSettings({ ...development, APP_ENV: "fixture" })).toBeNull();
    expect(readEmbeddedStudioSettings({ ...development, GITHUB_EVENT_NAME: "pull_request" })).toBeNull();
  });

  it("rejects target mismatch and invalid owner origins without passing credential-bearing input through", () => {
    for (const input of [
      { ...development, SANITY_DATASET: "production" },
      { ...development, SITE_URL: "https://owner.invalid/?credential=synthetic-private" },
      { ...development, VERCEL_URL: "owner.vercel.app@attacker.invalid" },
    ]) {
      expect(() => readEmbeddedStudioSettings(input)).toThrow();
    }
  });

  it("constructs shared Studio config from explicit public settings despite conflicting CLI environment", () => {
    vi.stubEnv("SANITY_STUDIO_PROJECT_ID", "wrong-client-env");
    vi.stubEnv("SANITY_STUDIO_DATASET", "wrong-client-dataset");
    const settings = readEmbeddedStudioSettings(development)!;
    const config = createStudioConfig(settings);
    expect(config).toMatchObject({ projectId: settings.projectId, dataset: settings.dataset });
    expect(config.document?.badges).toBeTypeOf("function");
    expect(config.document?.actions).toBeTypeOf("function");
  });
});
