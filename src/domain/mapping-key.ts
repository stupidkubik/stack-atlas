import { isPackageId, isProductId, isRepositoryId, type PackageId, type ProductId, type RepositoryId } from "./ids";

export interface MappingKeyInput {
  readonly productId: ProductId;
  readonly primaryPackage: {
    readonly id: PackageId;
    readonly packageName: string;
  } | null;
  readonly primaryRepository: {
    readonly id: RepositoryId;
    readonly owner: string;
    readonly name: string;
  } | null;
  readonly sdkPackageVersion: string | null;
}

/** Hashes only stable source identity. Editorial names, routes and text are excluded. */
export async function computeMappingKey(input: MappingKeyInput): Promise<string> {
  if (!isProductId(input.productId)) throw new Error("Invalid mapping product ID.");
  if (input.primaryPackage !== null && (
    !isPackageId(input.primaryPackage.id) || !nonEmpty(input.primaryPackage.packageName)
  )) throw new Error("Invalid primary package identity.");
  if (input.primaryRepository !== null && (
    !isRepositoryId(input.primaryRepository.id) ||
    !nonEmpty(input.primaryRepository.owner) ||
    !nonEmpty(input.primaryRepository.name)
  )) throw new Error("Invalid primary repository identity.");
  if (input.sdkPackageVersion !== null && (
    !nonEmpty(input.sdkPackageVersion) || input.primaryPackage === null
  )) throw new Error("Invalid SDK package version.");

  // The key order is part of the persisted review contract. Keep this flat and explicit.
  const canonical = JSON.stringify({
    packageId: input.primaryPackage?.id ?? null,
    packageName: input.primaryPackage?.packageName ?? null,
    productId: input.productId,
    repositoryId: input.primaryRepository?.id ?? null,
    repositoryName: input.primaryRepository?.name ?? null,
    repositoryOwner: input.primaryRepository?.owner ?? null,
    sdkPackageVersion: input.sdkPackageVersion,
  });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nonEmpty(value: string): boolean {
  return value.length > 0 && value.trim() === value;
}
