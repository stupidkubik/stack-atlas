import { createStudioConfig } from "./studio/config";

export default createStudioConfig({
  projectId: process.env.SANITY_STUDIO_PROJECT_ID || "missing-project-id",
  dataset: process.env.SANITY_STUDIO_DATASET || "development",
  previewOrigin: process.env.SANITY_STUDIO_PREVIEW_ORIGIN || "http://localhost:3000",
});
