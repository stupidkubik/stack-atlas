import { defineConfig } from "sanity";
import { presentationTool } from "sanity/presentation";
import { structureTool } from "sanity/structure";
import { documentTypes, schemaTypes } from "./schemas";
import { siteDocumentTypes } from "./schemas/site";
import { aiReviewAgeBadge } from "./badges/ai-review-age";
import { controlledPublishAction } from "./actions/controlled-publish";

export interface StudioPublicSettings {
  readonly projectId: string;
  readonly dataset: string;
  readonly previewOrigin: string;
}

/** Shared Studio configuration; callers supply only public target identity. */
export function createStudioConfig({ projectId, dataset, previewOrigin }: StudioPublicSettings) {
  return defineConfig({
    name: "pkgcompass",
    title: "PkgCompass",
    projectId,
    dataset,
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
      badges: (previous) => [...previous, aiReviewAgeBadge],
      actions: (previous, context) => {
        if (![...documentTypes, ...siteDocumentTypes].some(({ name }) => name === context.schemaType)) return previous;
        return previous.map((action) => action.action === "publish" ? controlledPublishAction : action);
      },
    },
  });
}
