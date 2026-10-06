import { packageId, productId, repositoryId } from "../../../src/domain/ids";
import type { MappingKeyInput } from "../../../src/domain/mapping-key";

/** Synthetic mappings used to exercise scoped, monorepo, missing-SDK, and rename behavior. */
export const dataMappingFixtures = {
  ordinary: {
    productId: productId("prd_fixture_ordinary"),
    primaryPackage: { id: packageId("pkg_fixture_ordinary"), packageName: "fixture-cms" },
    primaryRepository: { id: repositoryId("repo_fixture_ordinary"), owner: "fixture-vendor", name: "cms" },
    sdkPackageVersion: "1.0.0",
  },
  scoped: {
    productId: productId("prd_fixture_scoped"),
    primaryPackage: { id: packageId("pkg_fixture_scoped"), packageName: "@fixture/cms-sdk" },
    primaryRepository: { id: repositoryId("repo_fixture_scoped"), owner: "fixture-vendor", name: "cms-sdk" },
    sdkPackageVersion: "2.1.0",
  },
  monorepo: {
    productId: productId("prd_fixture_monorepo"),
    primaryPackage: { id: packageId("pkg_fixture_monorepo_primary"), packageName: "@fixture/monorepo-cms" },
    primaryRepository: { id: repositoryId("repo_fixture_monorepo"), owner: "fixture-vendor", name: "monorepo" },
    sdkPackageVersion: "3.0.0",
    additionalPackageIds: [packageId("pkg_fixture_monorepo_other")],
  },
  noSdk: {
    productId: productId("prd_fixture_no_sdk"),
    primaryPackage: null,
    primaryRepository: { id: repositoryId("repo_fixture_no_sdk"), owner: "fixture-vendor", name: "no-sdk-cms" },
    sdkPackageVersion: null,
  },
} as const satisfies Record<string, MappingKeyInput | (MappingKeyInput & { readonly additionalPackageIds: readonly string[] })>;

export const renamedExternalPackageFixture: MappingKeyInput = {
  ...dataMappingFixtures.scoped,
  primaryPackage: { ...dataMappingFixtures.scoped.primaryPackage, packageName: "@fixture/cms-client" },
};

export const changedSdkVersionFixture: MappingKeyInput = {
  ...dataMappingFixtures.scoped,
  sdkPackageVersion: "2.2.0",
};
