/** Published, allowlisted provisioning read. No document bodies are returned. */
export const PUBLISHED_DOCUMENT_COUNTS_QUERY = `
  {
    "products": count(*[_type == "product"]),
    "packages": count(*[_type == "package"]),
    "repositories": count(*[_type == "repository"])
  }
`;
