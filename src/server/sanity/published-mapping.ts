import "server-only";

import { createClient } from "@sanity/client";
import { computeMappingKey } from "../../domain/mapping-key";
import { aiReviewDocumentId, productContentDocumentId } from "../../domain/cms-document-ids";
import {
  isPackageId,
  isProductId,
  isRepositoryId,
  packageId,
  productId,
  repositoryId,
  type ProductId,
} from "../../domain/ids";
import type { MappingIdentity } from "../../domain/data-contracts";
import type { EnvironmentSource } from "../config/environment";
import { selectComponentTarget, type LiveTarget } from "../config/targets";
import { fixtureSnapshot } from "../fixtures/catalog";

const READ_TIMEOUT_MS = 8_000;

export interface PublishedMetricsMapping extends MappingIdentity {
  readonly sdkPackageVersion: string | null;
  readonly mappingKey: string;
  readonly npmPackageName: string | null;
  readonly githubRepository: { readonly owner: string; readonly name: string; readonly url: string } | null;
}

export type PublishedMappingsResult =
  | { readonly ok: true; readonly value: readonly PublishedMetricsMapping[] }
  | { readonly ok: false; readonly code: "cms_unavailable" | "invalid_response" };

type RecordValue = Record<string, unknown>;
type Query = (groq: string, params?: Record<string, unknown>) => Promise<unknown>;

const queryFor = (filtered: boolean) => {
  const productFilter = filtered ? " && _id in $productIds" : "";
  const ownerFilter = `productId._ref in *[_type == \"product\"${productFilter}]._id`;
  return `{
    "products": *[_type == "product"${productFilter}]{_id, packageIds[]{_ref}, repositoryIds[]{_ref}, primaryPackageId{_ref}, primaryRepositoryId{_ref}},
    "productContent": *[_type == "productContent" && locale == "en" && productId._ref in *[_type == "product"${productFilter}]._id]{_id, productId{_ref}, locale, noPackageReason},
    "packages": *[_type == "package" && ${ownerFilter}]{_id, productId{_ref}, packageName, role},
    "repositories": *[_type == "repository" && ${ownerFilter}]{_id, productId{_ref}, owner, name, role, officialSourceUrl},
    "aiReviews": *[_type == "aiReview" && productId._ref in *[_type == "product"${productFilter}]._id]{_id, productId{_ref}, mappingKey, signals[]{key,evidence[]{packageVersion}}}
  }`;
};

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function list(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function reference(value: unknown): string | undefined {
  const item = record(value);
  return typeof item?._ref === "string" ? item._ref : undefined;
}

function references(value: unknown): string[] | undefined {
  const values = list(value);
  if (!values) return undefined;
  const ids = values.map(reference);
  return ids.every((id): id is string => Boolean(id)) && new Set(ids).size === ids.length ? ids : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function safeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function uniqueRecords(value: unknown, idGuard: (id: unknown) => id is string): Map<string, RecordValue> | undefined {
  const values = list(value);
  if (!values) return undefined;
  const output = new Map<string, RecordValue>();
  for (const candidate of values) {
    const item = record(candidate);
    if (!item || !idGuard(item._id) || output.has(item._id)) return undefined;
    output.set(item._id, item);
  }
  return output;
}

function validPackageName(value: unknown): value is string {
  return nonEmpty(value) && /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(value);
}

function validGithubPart(value: unknown): value is string {
  return nonEmpty(value) && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== "." && value !== "..";
}

function packageVersion(review: RecordValue | undefined): string | null | undefined {
  if (!review) return null;
  const signals = list(review.signals);
  if (!signals) return undefined;
  const types = signals.map(record).filter((signal) => signal?.key === "types");
  if (types.length !== 1) return undefined;
  const evidence = list(types[0]?.evidence);
  if (!evidence) return undefined;
  const versions = evidence.map(record).flatMap((item) => item?.packageVersion === undefined ? [] : [item.packageVersion]);
  if (versions.some((version) => !nonEmpty(version))) return undefined;
  const uniqueVersions = [...new Set(versions as string[])];
  if (uniqueVersions.length > 1) return undefined;
  return uniqueVersions[0] ?? null;
}

/** Strict mapping projection shared by the collector and mapping-key review. */
export async function projectPublishedMappings(query: Query, requestedProductIds?: readonly ProductId[]): Promise<readonly PublishedMetricsMapping[] | undefined> {
  if (requestedProductIds && (requestedProductIds.some((id) => !isProductId(id)) || new Set(requestedProductIds).size !== requestedProductIds.length)) return undefined;
  const raw = record(await query(queryFor(Boolean(requestedProductIds)), requestedProductIds ? { productIds: [...requestedProductIds] } : undefined));
  if (!raw) return undefined;
  const products = uniqueRecords(raw.products, isProductId);
  const packages = uniqueRecords(raw.packages, isPackageId);
  const repositories = uniqueRecords(raw.repositories, isRepositoryId);
  const contentRows = list(raw.productContent);
  const reviewRows = list(raw.aiReviews);
  if (!products || !packages || !repositories || !contentRows || !reviewRows) return undefined;

  const contentsByProduct = new Map<string, RecordValue>();
  for (const candidate of contentRows) {
    const item = record(candidate); const owner = reference(item?.productId);
    if (!item || item.locale !== "en" || !owner || contentsByProduct.has(owner)) return undefined;
    contentsByProduct.set(owner, item);
  }
  const reviewsByProduct = new Map<string, RecordValue>();
  for (const candidate of reviewRows) {
    const item = record(candidate); const owner = reference(item?.productId);
    if (!item || !owner || !/^prd_[a-z0-9_]+$/.test(owner) || item._id !== aiReviewDocumentId(owner) || reviewsByProduct.has(owner)) return undefined;
    reviewsByProduct.set(owner, item);
  }

  const packageOwners = new Map<string, string[]>();
  for (const item of packages.values()) {
    const owner = reference(item.productId);
    if (!owner || !products.has(owner) || !validPackageName(item.packageName) || !["primary_js_sdk", "additional"].includes(String(item.role))) return undefined;
    packageOwners.set(owner, [...(packageOwners.get(owner) ?? []), item._id as string]);
  }
  const repositoryOwners = new Map<string, string[]>();
  for (const item of repositories.values()) {
    const owner = reference(item.productId);
    if (!owner || !products.has(owner) || !validGithubPart(item.owner) || !validGithubPart(item.name) || !["primary", "additional"].includes(String(item.role)) || !safeHttpUrl(item.officialSourceUrl)) return undefined;
    repositoryOwners.set(owner, [...(repositoryOwners.get(owner) ?? []), item._id as string]);
  }

  const output: PublishedMetricsMapping[] = [];
  for (const [id, product] of products) {
    const productPackages = references(product.packageIds); const productRepositories = references(product.repositoryIds);
    if (!productPackages || !productRepositories) return undefined;
    const ownedPackageIds = packageOwners.get(id) ?? [];
    const ownedRepositoryIds = repositoryOwners.get(id) ?? [];
    if (ownedPackageIds.some((packageIdValue) => !productPackages.includes(packageIdValue)) || ownedRepositoryIds.some((repositoryIdValue) => !productRepositories.includes(repositoryIdValue))) return undefined;
    if (productPackages.some((packageIdValue) => reference(packages.get(packageIdValue)?.productId) !== id) || productRepositories.some((repositoryIdValue) => reference(repositories.get(repositoryIdValue)?.productId) !== id)) return undefined;

    const primaryPackageId = reference(product.primaryPackageId);
    const primaryRepositoryId = reference(product.primaryRepositoryId);
    if ((primaryPackageId && (!productPackages.includes(primaryPackageId) || !isPackageId(primaryPackageId))) ||
      (primaryRepositoryId && (!productRepositories.includes(primaryRepositoryId) || !isRepositoryId(primaryRepositoryId)))) return undefined;
    const primaryPackageDoc = primaryPackageId ? packages.get(primaryPackageId) : undefined;
    const primaryRepositoryDoc = primaryRepositoryId ? repositories.get(primaryRepositoryId) : undefined;
    if ((primaryPackageId && (!primaryPackageDoc || primaryPackageDoc.role !== "primary_js_sdk")) ||
      (primaryRepositoryId && (!primaryRepositoryDoc || primaryRepositoryDoc.role !== "primary"))) return undefined;
    const packagePrimaryCount = productPackages.filter((packageRef) => packages.get(packageRef)?.role === "primary_js_sdk").length;
    const repositoryPrimaryCount = productRepositories.filter((repositoryRef) => repositories.get(repositoryRef)?.role === "primary").length;
    if (packagePrimaryCount !== (primaryPackageId ? 1 : 0) || repositoryPrimaryCount !== (primaryRepositoryId ? 1 : 0)) return undefined;

    const content = contentsByProduct.get(id);
    if (!content || content._id !== productContentDocumentId(id) || (primaryPackageId === undefined && !nonEmpty(content.noPackageReason))) return undefined;
    const review = reviewsByProduct.get(id);
    const sdkPackageVersion = packageVersion(review);
    if (sdkPackageVersion === undefined || (sdkPackageVersion !== null && !primaryPackageId)) return undefined;
    const primaryPackage: MappingIdentity["primaryPackage"] = primaryPackageDoc
      ? { id: packageId(primaryPackageDoc._id as string), packageName: primaryPackageDoc.packageName as string }
      : null;
    const primaryRepository: MappingIdentity["primaryRepository"] = primaryRepositoryDoc
      ? { id: repositoryId(primaryRepositoryDoc._id as string), owner: primaryRepositoryDoc.owner as string, name: primaryRepositoryDoc.name as string }
      : null;
    const mapping = { productId: productId(id), primaryPackage, primaryRepository };
    const mappingKey = await computeMappingKey({ ...mapping, sdkPackageVersion });
    const githubRepository = primaryRepositoryDoc
      ? { owner: primaryRepositoryDoc.owner as string, name: primaryRepositoryDoc.name as string, url: `https://github.com/${primaryRepositoryDoc.owner}/${primaryRepositoryDoc.name}` }
      : null;
    output.push({ ...mapping, sdkPackageVersion, mappingKey, npmPackageName: primaryPackage?.packageName ?? null, githubRepository });
  }
  return output;
}

function fixtureMappings(): readonly PublishedMetricsMapping[] {
  return fixtureSnapshot.products.filter((item) => item.state === "published").map((product) => {
    const packageDoc = product.primaryPackageId ? fixtureSnapshot.packages.find((item) => item.id === product.primaryPackageId) : undefined;
    const repositoryDoc = product.primaryRepositoryId ? fixtureSnapshot.repositories.find((item) => item.id === product.primaryRepositoryId) : undefined;
    return {
      productId: product.id,
      primaryPackage: packageDoc ? { id: packageDoc.id, packageName: packageDoc.packageName } : null,
      primaryRepository: repositoryDoc ? { id: repositoryDoc.id, owner: repositoryDoc.owner, name: repositoryDoc.name } : null,
      sdkPackageVersion: null,
      mappingKey: "fixture-only",
      npmPackageName: packageDoc?.packageName ?? null,
      githubRepository: repositoryDoc ? { owner: repositoryDoc.owner, name: repositoryDoc.name, url: `https://github.com/${repositoryDoc.owner}/${repositoryDoc.name}` } : null,
    };
  });
}

export async function readPublishedMappings(
  requestedProductIds?: readonly ProductId[],
  source: EnvironmentSource = process.env,
  explicitTarget?: LiveTarget<"content">,
): Promise<PublishedMappingsResult> {
  try {
    const target = explicitTarget ?? selectComponentTarget("content", source);
    if (target.mode === "fixture") {
      const mappings = fixtureMappings();
      return { ok: true, value: requestedProductIds ? mappings.filter(({ productId: id }) => requestedProductIds.includes(id)) : mappings };
    }
    const client = createClient({
      projectId: target.settings.SANITY_PROJECT_ID,
      dataset: target.settings.SANITY_DATASET,
      apiVersion: target.settings.SANITY_API_VERSION,
      useCdn: false,
      perspective: "published",
    });
    const value = await projectPublishedMappings(
      (groq, params) => client.fetch(groq, params ?? {}, { timeout: READ_TIMEOUT_MS }),
      requestedProductIds,
    );
    return value ? { ok: true, value } : { ok: false, code: "invalid_response" };
  } catch {
    return { ok: false, code: "cms_unavailable" };
  }
}
