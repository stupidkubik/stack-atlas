export function unpackPosthogEvents(
  body: Uint8Array | null,
  url: string,
  contentEncoding: string | undefined,
): readonly { readonly event: string; readonly properties: unknown }[];
