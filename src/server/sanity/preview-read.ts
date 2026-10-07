import "server-only";

import { createClient } from "@sanity/client";
import { productContentDocumentId } from "../../domain/cms-document-ids";
import { isProductId } from "../../domain/ids";
import { selectComponentTarget } from "../config/targets";

const TIMEOUT_MS = 8_000;

export interface PreviewProduct {
  readonly displayName?: string;
  readonly routeSlug?: string;
  readonly summary?: string;
  readonly useCases?: readonly { readonly key?: string; readonly text?: string }[];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= maximum ? value : undefined;
}

function projectPreviewProduct(value: unknown, requestedSlug: string): PreviewProduct | undefined {
  const doc = object(value);
  const slug = optionalText(object(doc?.routeSlug)?.current, 120);
  if (!doc || !slug || slug !== requestedSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return undefined;
  const content = object(doc.content);
  const useCases = Array.isArray(content?.useCases) ? content.useCases.map((input) => {
    const item = object(input);
    return item && optionalText(item.key, 40) && optionalText(item.text, 500)
      ? { key: item.key as string, text: item.text as string }
      : undefined;
  }).filter((item): item is { key: string; text: string } => Boolean(item)) : undefined;
  return {
    ...(optionalText(doc.displayName, 100) ? { displayName: doc.displayName as string } : {}),
    routeSlug: slug,
    ...(optionalText(content?.summary, 500) ? { summary: content!.summary as string } : {}),
    ...(useCases ? { useCases } : {}),
  };
}

/** Draft perspective is reached only after the request-scoped preview session is verified. */
export async function readPreviewProduct(slug: string): Promise<PreviewProduct | undefined> {
  try {
    const content = selectComponentTarget("content");
    const preview = selectComponentTarget("preview");
    if (content.mode !== "live" || preview.mode !== "live" ||
      content.settings.SANITY_PROJECT_ID !== process.env.SANITY_STUDIO_PROJECT_ID ||
      content.settings.SANITY_DATASET !== process.env.SANITY_STUDIO_DATASET) return undefined;
    const client = createClient({
      projectId: content.settings.SANITY_PROJECT_ID,
      dataset: content.settings.SANITY_DATASET,
      apiVersion: content.settings.SANITY_API_VERSION,
      token: preview.settings.SANITY_PREVIEW_READ_TOKEN,
      useCdn: false,
      perspective: "drafts",
      stega: false,
    });
    const rawProduct = await client.fetch<unknown>(
      `*[_type == "product" && routeSlug.current == $slug][0]{_id,displayName,routeSlug}`,
      { slug },
      { timeout: TIMEOUT_MS },
    );
    const product = object(rawProduct);
    if (!product || !isProductId(product._id)) return undefined;
    const contentId = productContentDocumentId(product._id);
    const contentDocument = await client.fetch<unknown>(
      `*[_id == $id][0]{summary,useCases[]{key,text}}`,
      { id: contentId },
      { timeout: TIMEOUT_MS },
    );
    return projectPreviewProduct({ ...product, content: contentDocument }, slug);
  } catch {
    return undefined;
  }
}
