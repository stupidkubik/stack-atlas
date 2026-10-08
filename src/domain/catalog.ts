import type {
  CategoryId,
  ComparisonId,
  PackageId,
  PairKey,
  ProductId,
  RepositoryId,
} from "./ids";
import {
  categoryId,
  comparisonId,
  isCategoryId,
  isComparisonId,
  isPackageId,
  isProductId,
  isRepositoryId,
  pairKey,
  productId,
} from "./ids";
import { isUtcDateTime, type UtcDateTime } from "./utc";
import { denseDataArray, plainDataRecord } from "./safe-objects";

export type PublicationState = "draft" | "published";
export type Locale = "en";

export interface Product {
  readonly id: ProductId;
  readonly displayName: string;
  readonly routeSlug: string;
  readonly categoryIds: readonly CategoryId[];
  readonly packageIds: readonly PackageId[];
  readonly repositoryIds: readonly RepositoryId[];
  readonly primaryPackageId?: PackageId;
  readonly primaryRepositoryId?: RepositoryId;
  readonly state: PublicationState;
}

export interface PackageReference {
  readonly id: PackageId;
  readonly productId: ProductId;
  readonly packageName: string;
  readonly role: "primary_js_sdk" | "additional";
  readonly officialSourceUrl: string;
}

export interface RepositoryReference {
  readonly id: RepositoryId;
  readonly productId: ProductId;
  readonly owner: string;
  readonly name: string;
  readonly scope: "product" | "package";
  readonly packageId?: PackageId;
  readonly role: "primary" | "additional";
  readonly officialSourceUrl: string;
}

export interface ProductContentRevision {
  readonly documentId: string;
  readonly productId: ProductId;
  readonly locale: Locale;
  readonly state: PublicationState;
  readonly summary: string;
  readonly noPackageReason?: string;
}

export interface Comparison {
  readonly id: ComparisonId;
  readonly productIds: readonly [ProductId, ProductId];
  readonly pairKey: PairKey;
  readonly categoryId: CategoryId;
  readonly state: PublicationState;
}

export interface ComparisonContentRevision {
  readonly documentId: string;
  readonly comparisonId: ComparisonId;
  readonly locale: Locale;
  readonly state: PublicationState;
  readonly title: string;
}

export interface AiReviewProjection {
  readonly id: string;
  readonly productId: ProductId;
  readonly mappingKey: string;
  readonly methodologyVersion: string;
  readonly reviewerLabel: string;
  readonly signals: readonly [AiSignal, AiSignal, AiSignal];
  readonly reviewedAt: UtcDateTime;
  readonly state: PublicationState;
}

export type AiSignalKey = "types" | "llmsTxt" | "mcp";
export type AiSignalState = "present" | "absent" | "unknown" | "error" | "not_applicable";

export interface AiSignalEvidence {
  readonly sourceUrl: string;
  readonly officialSourceUrl?: string;
  readonly finding: string;
  readonly checkedAt: UtcDateTime;
  readonly packageVersion?: string;
  readonly entryPoints?: readonly string[];
}

export interface AiSignal {
  readonly key: AiSignalKey;
  readonly state: AiSignalState;
  readonly reason?: string;
  readonly scope: string;
  readonly checkedAt: UtcDateTime | null;
  readonly evidence: readonly AiSignalEvidence[];
  readonly kind?: "bundled" | "external" | "none" | null;
}

export interface CatalogSnapshot {
  readonly products: readonly Product[];
  readonly productContent: readonly ProductContentRevision[];
  readonly packages: readonly PackageReference[];
  readonly repositories: readonly RepositoryReference[];
  readonly comparisons: readonly Comparison[];
  readonly comparisonContent: readonly ComparisonContentRevision[];
  readonly aiReviews: readonly AiReviewProjection[];
}

export interface PublishedProduct {
  readonly product: Product;
  readonly content: ProductContentRevision;
  readonly packages: readonly PackageReference[];
  readonly repositories: readonly RepositoryReference[];
  readonly aiReview?: AiReviewProjection;
}

export interface PublishedComparison {
  readonly comparison: Comparison;
  readonly content: ComparisonContentRevision;
}

export interface PublishedCatalog {
  readonly products: readonly PublishedProduct[];
  readonly comparisons: readonly PublishedComparison[];
}

function ownString(value: unknown): value is string {
  return typeof value === "string";
}

function oneOf<Value extends string>(value: unknown, allowed: readonly Value[]): value is Value {
  return typeof value === "string" && allowed.includes(value as Value);
}

function projectAiReview(input: unknown): AiReviewProjection | undefined {
  const review = plainDataRecord(input);
  const signalInputs = review && denseDataArray(review.signals);
  if (!review || !signalInputs || signalInputs.length !== 3) {
    return undefined;
  }

  const expectedKeys: readonly AiSignalKey[] = ["types", "llmsTxt", "mcp"];
  const signals = signalInputs.map((signalInput, index): AiSignal | undefined => {
    const signal = plainDataRecord(signalInput);
    const evidenceInputs = signal && denseDataArray(signal.evidence);
    const signalKey = signal?.key;
    if (
      !signal ||
      !oneOf(signalKey, expectedKeys) ||
      signalKey !== expectedKeys[index] ||
      !evidenceInputs
    ) return undefined;
    if (
      !oneOf(signal.state, ["present", "absent", "unknown", "error", "not_applicable"] as const) ||
      !ownString(signal.scope) ||
      !(signal.checkedAt === null || isUtcDateTime(signal.checkedAt)) ||
      !evidenceInputs
    ) {
      return undefined;
    }
    if (
      signalKey === "types" &&
      !(signal.kind === undefined || signal.kind === null || oneOf(signal.kind, ["bundled", "external", "none"] as const))
    ) {
      return undefined;
    }

    const evidence = evidenceInputs.map((itemInput): AiSignalEvidence | undefined => {
      const item = plainDataRecord(itemInput);
      if (!item) return undefined;
      const entryPoints = item.entryPoints === undefined ? undefined : denseDataArray(item.entryPoints);
      if (
        !ownString(item.sourceUrl) ||
        !ownString(item.finding) ||
        !isUtcDateTime(item.checkedAt) ||
        (item.officialSourceUrl !== undefined && !ownString(item.officialSourceUrl)) ||
        (item.packageVersion !== undefined && !ownString(item.packageVersion)) ||
        (item.entryPoints !== undefined && (!entryPoints || !entryPoints.every(ownString)))
      ) {
        return undefined;
      }
      return {
        sourceUrl: item.sourceUrl,
        finding: item.finding,
        checkedAt: item.checkedAt as UtcDateTime,
        ...(item.officialSourceUrl !== undefined ? { officialSourceUrl: item.officialSourceUrl } : {}),
        ...(item.packageVersion !== undefined ? { packageVersion: item.packageVersion } : {}),
        ...(entryPoints ? { entryPoints: entryPoints as string[] } : {}),
      };
    });
    if (evidence.some((item) => item === undefined)) return undefined;

    return {
      key: signalKey as AiSignalKey,
      state: signal.state as AiSignalState,
      ...(ownString(signal.reason) ? { reason: signal.reason } : {}),
      scope: signal.scope,
      checkedAt: signal.checkedAt as UtcDateTime | null,
      evidence: evidence as AiSignalEvidence[],
      ...(signalKey === "types" && signal.kind !== undefined
        ? { kind: signal.kind as AiSignal["kind"] }
        : {}),
    };
  });

  if (
    !ownString(review.id) ||
    !isProductId(review.productId) ||
    !ownString(review.mappingKey) ||
    !ownString(review.methodologyVersion) ||
    !ownString(review.reviewerLabel) ||
    !isUtcDateTime(review.reviewedAt) ||
    review.state !== "published" ||
    signals.some((signal) => signal === undefined)
  ) {
    return undefined;
  }

  return {
    id: review.id,
    productId: productId(review.productId),
    mappingKey: review.mappingKey,
    methodologyVersion: review.methodologyVersion,
    reviewerLabel: review.reviewerLabel,
    signals: signals as [AiSignal, AiSignal, AiSignal],
    reviewedAt: review.reviewedAt as UtcDateTime,
    state: "published",
  };
}

function projectProduct(input: unknown): Product | undefined {
  const product = plainDataRecord(input);
  if (!product) return undefined;
  const categoryIds = denseDataArray(product.categoryIds);
  const packageIds = denseDataArray(product.packageIds);
  const repositoryIds = denseDataArray(product.repositoryIds);
  if (
    !isProductId(product.id) ||
    !ownString(product.displayName) ||
    !ownString(product.routeSlug) ||
    !categoryIds ||
    !categoryIds.every(isCategoryId) ||
    !packageIds ||
    !packageIds.every(isPackageId) ||
    !repositoryIds ||
    !repositoryIds.every(isRepositoryId) ||
    (product.primaryPackageId !== undefined && !isPackageId(product.primaryPackageId)) ||
    (product.primaryRepositoryId !== undefined && !isRepositoryId(product.primaryRepositoryId)) ||
    (product.state !== "published" && product.state !== "draft")
  ) {
    return undefined;
  }
  return {
    id: productId(product.id),
    displayName: product.displayName,
    routeSlug: product.routeSlug,
    categoryIds: categoryIds.map((id) => id as CategoryId),
    packageIds: packageIds as PackageId[],
    repositoryIds: repositoryIds as RepositoryId[],
    ...(product.primaryPackageId ? { primaryPackageId: product.primaryPackageId } : {}),
    ...(product.primaryRepositoryId ? { primaryRepositoryId: product.primaryRepositoryId } : {}),
    state: product.state,
  };
}

function projectProductContent(input: unknown): ProductContentRevision | undefined {
  const content = plainDataRecord(input);
  if (!content) return undefined;
  if (
    !ownString(content.documentId) ||
    content.documentId.startsWith("drafts.") ||
    !isProductId(content.productId) ||
    content.locale !== "en" ||
    content.state !== "published" ||
    !ownString(content.summary) ||
    (content.noPackageReason !== undefined && !ownString(content.noPackageReason))
  ) {
    return undefined;
  }
  return {
    documentId: content.documentId,
    productId: productId(content.productId),
    locale: "en",
    state: "published",
    summary: content.summary,
    ...(content.noPackageReason !== undefined ? { noPackageReason: content.noPackageReason } : {}),
  };
}

function projectPackage(input: unknown): PackageReference | undefined {
  const item = plainDataRecord(input);
  if (!item) return undefined;
  if (
    !isPackageId(item.id) ||
    !isProductId(item.productId) ||
    !ownString(item.packageName) ||
    !oneOf(item.role, ["primary_js_sdk", "additional"] as const) ||
    !ownString(item.officialSourceUrl)
  ) return undefined;
  return {
    id: item.id as PackageId,
    productId: productId(item.productId),
    packageName: item.packageName,
    role: item.role as PackageReference["role"],
    officialSourceUrl: item.officialSourceUrl,
  };
}

function projectRepository(input: unknown): RepositoryReference | undefined {
  const item = plainDataRecord(input);
  if (!item) return undefined;
  if (
    !isRepositoryId(item.id) ||
    !isProductId(item.productId) ||
    !ownString(item.owner) ||
    !ownString(item.name) ||
    !oneOf(item.scope, ["product", "package"] as const) ||
    !oneOf(item.role, ["primary", "additional"] as const) ||
    !ownString(item.officialSourceUrl) ||
    (item.packageId !== undefined && !isPackageId(item.packageId))
  ) return undefined;
  return {
    id: item.id as RepositoryId,
    productId: productId(item.productId),
    owner: item.owner,
    name: item.name,
    scope: item.scope as RepositoryReference["scope"],
    role: item.role as RepositoryReference["role"],
    officialSourceUrl: item.officialSourceUrl,
    ...(item.packageId ? { packageId: item.packageId } : {}),
  };
}

function projectComparison(input: unknown): Comparison | undefined {
  const comparison = plainDataRecord(input);
  if (!comparison) return undefined;
  const productIds = denseDataArray(comparison.productIds);
  if (
    !isComparisonId(comparison.id) ||
    !productIds ||
    productIds.length !== 2 ||
    !productIds.every(isProductId) ||
    productIds[0] >= productIds[1] ||
    !isCategoryId(comparison.categoryId) ||
    comparison.state !== "published"
  ) return undefined;
  const ids = [productId(productIds[0]), productId(productIds[1])] as const;
  let expectedPairKey: PairKey;
  try {
    expectedPairKey = pairKey(ids);
  } catch {
    return undefined;
  }
  if (comparison.pairKey !== expectedPairKey) return undefined;
  return {
    id: comparisonId(comparison.id),
    productIds: ids,
    pairKey: expectedPairKey,
    categoryId: categoryId(comparison.categoryId),
    state: "published",
  };
}

function projectComparisonContent(input: unknown): ComparisonContentRevision | undefined {
  const content = plainDataRecord(input);
  if (!content) return undefined;
  if (
    !ownString(content.documentId) ||
    content.documentId.startsWith("drafts.") ||
    !isComparisonId(content.comparisonId) ||
    content.locale !== "en" ||
    content.state !== "published" ||
    !ownString(content.title)
  ) return undefined;
  return {
    documentId: content.documentId,
    comparisonId: comparisonId(content.comparisonId),
    locale: "en",
    state: "published",
    title: content.title,
  };
}

export function toPublishedCatalog(snapshot: CatalogSnapshot): PublishedCatalog {
  const source = plainDataRecord(snapshot);
  const productInputs = source && denseDataArray(source.products);
  const contentInputs = source && denseDataArray(source.productContent);
  const packageInputs = source && denseDataArray(source.packages);
  const repositoryInputs = source && denseDataArray(source.repositories);
  const comparisonInputs = source && denseDataArray(source.comparisons);
  const comparisonContentInputs = source && denseDataArray(source.comparisonContent);
  const reviewInputs = source && denseDataArray(source.aiReviews);
  if (
    !productInputs || !contentInputs || !packageInputs || !repositoryInputs ||
    !comparisonInputs || !comparisonContentInputs || !reviewInputs
  ) return { products: [], comparisons: [] };

  const publishedContent = new Map(
    contentInputs
      .map(projectProductContent)
      .filter((content): content is ProductContentRevision => content !== undefined)
      .map((content) => [content.productId, content] as const),
  );
  const publishedReviews = new Map(
    reviewInputs
      .map(projectAiReview)
      .filter((review): review is AiReviewProjection => review !== undefined)
      .map((review) => [review.productId, review] as const),
  );
  const packages = packageInputs
    .map(projectPackage)
    .filter((item): item is PackageReference => item !== undefined);
  const repositories = repositoryInputs
    .map(projectRepository)
    .filter((item): item is RepositoryReference => item !== undefined);
  const products = productInputs.flatMap((input) => {
    const product = projectProduct(input);
    if (!product || product.state !== "published") return [];
    const content = publishedContent.get(product.id);
    if (!content || content.productId !== product.id) return [];

    const ownPackages = packages.filter(
      (item) => item.productId === product.id && product.packageIds.includes(item.id),
    );
    const ownRepositories = repositories.filter(
      (item) => item.productId === product.id && product.repositoryIds.includes(item.id),
    );
    const primaryPackageId = product.primaryPackageId;
    const primaryRepositoryId = product.primaryRepositoryId;
    if (
      (primaryPackageId && !ownPackages.some((item) => item.id === primaryPackageId)) ||
      (primaryRepositoryId && !ownRepositories.some((item) => item.id === primaryRepositoryId))
    ) return [];

    const review = publishedReviews.get(product.id);
    return [{
      product,
      content,
      packages: ownPackages,
      repositories: ownRepositories,
      ...(review ? { aiReview: review } : {}),
    }];
  });
  const publicProductIds = new Set(products.map(({ product }) => product.id));
  const publishedComparisonContent = new Map(
    comparisonContentInputs
      .map(projectComparisonContent)
      .filter((content): content is ComparisonContentRevision => content !== undefined)
      .map((content) => [content.comparisonId, content] as const),
  );
  const comparisons = comparisonInputs.flatMap((input) => {
    const comparison = projectComparison(input);
    if (!comparison) return [];
    const content = publishedComparisonContent.get(comparison.id);
    const pairIsPublic = comparison.productIds.every((id) => publicProductIds.has(id));
    if (!content || !pairIsPublic) return [];
    return [{ comparison, content }];
  });

  return { products, comparisons };
}
