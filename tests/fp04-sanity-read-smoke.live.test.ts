import { describe, expect, it } from "vitest";
import { SafeConfigurationError } from "../src/server/config/environment";
import { selectComponentTarget } from "../src/server/config/targets";
import {
  readDraftPreviewDocumentCounts,
  readPublishedDocumentCounts,
} from "../src/server/sanity/read-smoke";

const optedIn = process.env.PKGCOMPASS_SANITY_READ_SMOKE === "development";

describe.skipIf(!optedIn)("live Sanity development read smoke", () => {
  it("checks anonymous published counts and authenticated preview counts only", async () => {
    const configuredEnvironment = process.env.APP_ENV?.trim();
    if (configuredEnvironment && configuredEnvironment !== "development") {
      throw new Error("environment_mismatch");
    }

    let target: ReturnType<typeof selectComponentTarget<"content">>;
    try {
      target = selectComponentTarget("content", { ...process.env, APP_ENV: "development" });
    } catch (error) {
      const code = error instanceof SafeConfigurationError ? error.code : "invalid_configuration";
      throw new Error(code);
    }

    if (
      target.mode !== "live" ||
      process.env.SANITY_STUDIO_PROJECT_ID !== target.settings.SANITY_PROJECT_ID ||
      process.env.SANITY_STUDIO_DATASET !== target.settings.SANITY_DATASET
    ) throw new Error("studio_target_mismatch");

    const apiTarget = {
      projectId: target.settings.SANITY_PROJECT_ID,
      dataset: target.settings.SANITY_DATASET,
      apiVersion: target.settings.SANITY_API_VERSION,
    };
    const published = await readPublishedDocumentCounts(apiTarget);
    if (!published.ok) throw new Error(`published_${published.code}`);

    const previewToken = process.env.SANITY_PREVIEW_READ_TOKEN;
    if (!previewToken?.trim()) throw new Error("missing_preview_read_token");
    const preview = await readDraftPreviewDocumentCounts(apiTarget, previewToken);
    if (!preview.ok) throw new Error(`preview_${preview.code}`);

    const counts = published.value;
    const previewCounts = preview.value;
    console.log(
      `sanity_read_smoke target=pass published_read=pass preview_auth_query=pass mapping=not_run products=${counts.products} packages=${counts.packages} repositories=${counts.repositories} preview_products=${previewCounts.products} preview_packages=${previewCounts.packages} preview_repositories=${previewCounts.repositories}`,
    );
    expect(published.ok && preview.ok).toBe(true);
  }, 30_000);
});
