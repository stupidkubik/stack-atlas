/** Published Sanity documents must use the root path for anonymous reads. */
function rootDocumentId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Invalid public CMS document ID.");
  return value;
}

function locale(value: string): string {
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value)) throw new Error("Invalid CMS content locale.");
  return value;
}

export const productContentDocumentId = (productId: string, contentLocale = "en"): string =>
  rootDocumentId(`content_product_${productId}_${locale(contentLocale)}`);

export const categoryContentDocumentId = (categoryId: string, contentLocale = "en"): string =>
  rootDocumentId(`content_category_${categoryId}_${locale(contentLocale)}`);

export const comparisonContentDocumentId = (comparisonId: string, contentLocale = "en"): string =>
  rootDocumentId(`content_comparison_${comparisonId}_${locale(contentLocale)}`);

export const pageDocumentId = (pageKey: string, contentLocale = "en"): string =>
  rootDocumentId(`page_${pageKey}_${locale(contentLocale)}`);

export const aiReviewDocumentId = (productId: string): string => rootDocumentId(`ai_review_${productId}`);

export const siteSettingsDocumentId = (): string => "siteSettings_default";
