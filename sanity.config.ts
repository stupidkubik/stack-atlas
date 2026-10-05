import { defineConfig } from "sanity";

function requiredStudioValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`Set ${name} before starting Sanity Studio.`);
  }

  return normalized;
}

export default defineConfig({
  name: "default",
  title: "PkgCompass Studio",
  projectId: requiredStudioValue(
    process.env.SANITY_STUDIO_PROJECT_ID,
    "SANITY_STUDIO_PROJECT_ID",
  ),
  dataset: requiredStudioValue(
    process.env.SANITY_STUDIO_DATASET,
    "SANITY_STUDIO_DATASET",
  ),
  schema: { types: [] },
});
