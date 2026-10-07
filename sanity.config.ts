import { defineConfig } from "sanity";
import { presentationTool } from "sanity/presentation";
import { structureTool } from "sanity/structure";
import { documentTypes, schemaTypes } from "./studio/schemas";
import { siteDocumentTypes } from "./studio/schemas/site";
import { controlledPublishAction } from "./studio/actions/controlled-publish";

const previewOrigin = process.env.SANITY_STUDIO_PREVIEW_ORIGIN || "http://localhost:3000";

export default defineConfig({
  name: "pkgcompass",
  title: "PkgCompass",
  projectId: process.env.SANITY_STUDIO_PROJECT_ID || "missing-project-id",
  dataset: process.env.SANITY_STUDIO_DATASET || "development",
  plugins: [
    structureTool(),
    presentationTool({
      title: "Preview",
      previewUrl: {
        initial: `${previewOrigin}/en/`,
        previewMode: {
          enable: "/api/preview/enable/",
          disable: "/api/preview/disable/",
          shareAccess: false,
        },
      },
      resolve: {
        mainDocuments: [
          { route: "/en/tools/:slug/", filter: '_type == "product" && routeSlug.current == $slug', params: ({ params }) => ({ slug: params.slug }) },
          { route: "/en/compare/:pair/", filter: '_type == "comparison" && pairKey == $pair', params: ({ params }) => ({ pair: params.pair }) },
        ],
      },
    }),
  ],
  schema: { types: schemaTypes },
  document: {
    actions: (previous, context) => {
      if (![...documentTypes, ...siteDocumentTypes].some(({ name }) => name === context.schemaType)) return previous;
      return previous.map((action) => action.action === "publish" ? controlledPublishAction : action);
    },
  },
});
