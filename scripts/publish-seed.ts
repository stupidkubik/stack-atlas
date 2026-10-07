import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@sanity/client";
import type { AppEnvironment, EnvironmentSource } from "../src/server/config/environment";
import { SafeConfigurationError } from "../src/server/config/environment";
import { selectComponentTarget } from "../src/server/config/targets";
import { buildDevelopmentSeedDocuments, type SeedDocument } from "../src/domain/seed-records";

type PublishMode = "prepare" | "dry-run" | "apply";
interface PublishArgs {
  readonly environment: AppEnvironment;
  readonly mode: PublishMode;
  readonly manifestPath: string;
  readonly reportPath: string;
  readonly confirmedApply: boolean;
}

interface ManifestDocument {
  readonly id: string;
  readonly type: string;
  readonly draftRevision: string;
  readonly draftContentSha256: string;
}

interface SeedPublishManifest {
  readonly version: 1;
  readonly environment: "development";
  readonly seedDefinition: "cms-development-fixtures-v1";
  readonly documents: readonly ManifestDocument[];
  readonly manifestSha256: string;
}

type SanityDocument = Record<string, unknown> & { readonly _id: string; readonly _type: string };

export class SafeSeedPublishError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "SafeSeedPublishError"; this.code = code; }
}

function safeSanityFailureCode(error: unknown): string {
  if (error === null || typeof error !== "object") return "sanity_request_failed";
  const value = error as Record<string, unknown>;
  const response = value.response !== null && typeof value.response === "object" ? value.response as Record<string, unknown> : undefined;
  const status = [value.statusCode, value.status, response?.statusCode, response?.status]
    .find((candidate) => typeof candidate === "number" && Number.isInteger(candidate));
  if (typeof status === "number" && status >= 400 && status < 600) return `sanity_http_${status}`;
  if (value.name === "AbortError") return "sanity_timeout";
  if (value.name === "TypeError") return "sanity_network_error";
  return "sanity_request_failed";
}

export function parseSeedPublishArgs(argv: readonly string[]): PublishArgs {
  let environment: AppEnvironment | undefined;
  let mode: PublishMode | undefined;
  let manifestPath: string | undefined;
  let reportPath: string | undefined;
  let confirmedApply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--env") {
      if (environment || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new SafeSeedPublishError("seed_publish_invalid_arguments");
      const candidate = argv[++index];
      if (candidate !== "development") throw new SafeSeedPublishError("seed_publish_development_only");
      environment = candidate;
    } else if (argument === "--prepare" || argument === "--dry-run" || argument === "--apply") {
      if (mode) throw new SafeSeedPublishError("seed_publish_invalid_arguments");
      mode = argument.slice(2) as PublishMode;
    } else if (argument === "--manifest-path" || argument === "--report-path") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new SafeSeedPublishError("seed_publish_invalid_arguments");
      const value = argv[++index];
      if (argument === "--manifest-path") {
        if (manifestPath) throw new SafeSeedPublishError("seed_publish_invalid_arguments");
        manifestPath = value;
      } else {
        if (reportPath) throw new SafeSeedPublishError("seed_publish_invalid_arguments");
        reportPath = value;
      }
    } else if (argument === "--confirm-development-fixture-publication") {
      if (confirmedApply) throw new SafeSeedPublishError("seed_publish_invalid_arguments");
      confirmedApply = true;
    } else {
      throw new SafeSeedPublishError("seed_publish_invalid_arguments");
    }
  }
  if (!environment || !mode || !manifestPath || !reportPath || (mode === "apply") !== confirmedApply) throw new SafeSeedPublishError("seed_publish_invalid_arguments");
  return { environment, mode, manifestPath, reportPath, confirmedApply };
}

function loadLocalEnvironment(): void {
  try {
    const require = createRequire(import.meta.url);
    const { loadEnvConfig } = require("@next/env") as { loadEnvConfig: (directory: string, dev: boolean, logger?: { info(): void; error(): void }) => unknown };
    loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  } catch {
    throw new SafeSeedPublishError("seed_publish_environment_load_failed");
  }
}

function ensureLocalDevelopment(source: EnvironmentSource): EnvironmentSource {
  const hasCi = source.CI === "true" || source.CI === "1";
  const untrusted = (source.GITHUB_EVENT_NAME as string | undefined) === "pull_request" || source.PKGCOMPASS_UNTRUSTED_PR === "true" ||
    Boolean(source.VERCEL_GIT_PULL_REQUEST_ID?.trim()) || hasCi || Boolean(source.VERCEL || source.VERCEL_ENV);
  if (untrusted) throw new SafeSeedPublishError("seed_publish_untrusted_context");
  if (source.APP_ENV?.trim() && source.APP_ENV.trim() !== "development") throw new SafeSeedPublishError("seed_publish_environment_mismatch");
  return { ...source, APP_ENV: "development" };
}

function ensureStudioTarget(source: EnvironmentSource, projectId: string, dataset: string): void {
  if (source.SANITY_STUDIO_PROJECT_ID !== projectId || source.SANITY_STUDIO_DATASET !== dataset) {
    throw new SafeSeedPublishError("seed_publish_studio_target_mismatch");
  }
}

function resolveRunPath(path: string): string {
  const root = resolve(process.cwd(), "artifacts", "runs");
  const destination = resolve(path);
  const relativePath = relative(root, destination);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath) || !relativePath.endsWith(".json")) {
    throw new SafeSeedPublishError("seed_publish_artifact_path_invalid");
  }
  return destination;
}

function stableValue(value: unknown, root = false): unknown {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const ignored = root ? new Set(["_id", "_rev", "_createdAt", "_updatedAt"]) : new Set<string>();
  return Object.fromEntries(Object.keys(record).filter((key) => key !== "_key" && !ignored.has(key)).sort()
    .map((key) => [key, stableValue(record[key])]));
}

function stableJson(value: unknown): string { return JSON.stringify(stableValue(value, true)); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function contentHash(document: unknown): string { return sha256(stableJson(document)); }

function diffPaths(leftValue: unknown, rightValue: unknown, path = "$", output: string[] = []): readonly string[] {
  if (output.length >= 32) return output;
  const left = stableValue(leftValue, true);
  const right = stableValue(rightValue, true);
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) output.push(`${path}.length`);
    for (let index = 0; index < Math.min(left.length, right.length) && output.length < 32; index += 1) {
      diffPaths(left[index], right[index], `${path}[${index}]`, output);
    }
    return output;
  }
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    for (const key of [...keys].sort()) {
      if (output.length >= 32) break;
      if (!(key in leftRecord) || !(key in rightRecord)) output.push(`${path}.${key}`);
      else diffPaths(leftRecord[key], rightRecord[key], `${path}.${key}`, output);
    }
    return output;
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) output.push(path);
  return output;
}

function manifestPayload(manifest: Omit<SeedPublishManifest, "manifestSha256">): string {
  return JSON.stringify({
    version: manifest.version,
    environment: manifest.environment,
    seedDefinition: manifest.seedDefinition,
    documents: [...manifest.documents].sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function parseDocuments(value: unknown): Map<string, SanityDocument> {
  if (!Array.isArray(value)) throw new SafeSeedPublishError("seed_publish_invalid_document_response");
  const result = new Map<string, SanityDocument>();
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new SafeSeedPublishError("seed_publish_invalid_document_response");
    const document = item as Record<string, unknown>;
    if (typeof document._id !== "string" || typeof document._type !== "string" || result.has(document._id)) {
      throw new SafeSeedPublishError("seed_publish_invalid_document_response");
    }
    result.set(document._id, document as SanityDocument);
  }
  return result;
}

async function fetchDocuments(client: ReturnType<typeof createClient>, ids: readonly string[]): Promise<Map<string, SanityDocument>> {
  let raw: unknown;
  try {
    raw = await client.fetch<unknown>("*[_id in $ids]{...}", { ids }, { timeout: 10_000 });
  } catch (error) {
    throw new SafeSeedPublishError(safeSanityFailureCode(error));
  }
  return parseDocuments(raw);
}

async function readManifest(path: string): Promise<SeedPublishManifest> {
  let raw: string;
  try { raw = await readFile(resolveRunPath(path), "utf8"); } catch { throw new SafeSeedPublishError("seed_publish_manifest_unavailable"); }
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const manifest = value as Record<string, unknown>;
    if (manifest.version !== 1 || manifest.environment !== "development" || manifest.seedDefinition !== "cms-development-fixtures-v1" ||
      !Array.isArray(manifest.documents) || typeof manifest.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.manifestSha256)) throw new Error();
    const documents = manifest.documents.map((item): ManifestDocument => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error();
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.type !== "string" || typeof row.draftRevision !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(row.draftRevision) || typeof row.draftContentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.draftContentSha256)) throw new Error();
      return { id: row.id, type: row.type, draftRevision: row.draftRevision, draftContentSha256: row.draftContentSha256 };
    });
    const result: SeedPublishManifest = {
      version: 1,
      environment: "development",
      seedDefinition: "cms-development-fixtures-v1",
      documents,
      manifestSha256: manifest.manifestSha256,
    };
    const payload = manifestPayload(result);
    if (sha256(payload) !== result.manifestSha256) throw new Error();
    return result;
  } catch {
    throw new SafeSeedPublishError("seed_publish_manifest_invalid");
  }
}

export function prepareCanonicalSeedDocument(document: SeedDocument, expectedTypes: ReadonlyMap<string, string>): SeedDocument {
  function transform(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(transform);
    if (value === null || typeof value !== "object") return value;
    const item = value as Record<string, unknown>;
    if (item._type === "reference") {
      if (typeof item._ref !== "string" || item._weak !== true || !item._strengthenOnPublish || typeof item._strengthenOnPublish !== "object") {
        throw new SafeSeedPublishError("seed_publish_reference_not_weak");
      }
      const targetType = expectedTypes.get(item._ref);
      const strengthen = item._strengthenOnPublish as Record<string, unknown>;
      if (!targetType || strengthen.type !== targetType) throw new SafeSeedPublishError("seed_publish_reference_target_invalid");
      return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "_weak" && key !== "_strengthenOnPublish")
        .map(([key, child]) => [key, transform(child)]));
    }
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, transform(child)]));
  }
  return transform(document) as SeedDocument;
}

export function planCanonicalSeedWrites(
  documents: readonly SeedDocument[],
  existing: ReadonlyMap<string, SanityDocument>,
): { readonly rows: readonly { readonly id: string; readonly type: string; readonly operation: "create" | "skip" }[]; readonly toCreate: readonly SeedDocument[]; readonly canonicalState: "absent" | "partial" | "owned" } {
  const expectedById = new Map(documents.map((document) => [document._id, document]));
  const existingIdsAreExpected = [...existing.keys()].every((id) => expectedById.has(id));
  const existingMatchesOwned = documents.every((expected) => {
    const actual = existing.get(expected._id);
    return !actual || (actual._id === expected._id && actual._type === expected._type && contentHash(actual) === contentHash(expected));
  });
  const coreIds = new Set(documents.filter(({ _type }) => ["category", "comparison", "package", "product", "repository"].includes(_type)).map(({ _id }) => _id));
  const isAllowedPartialSet = existing.size === coreIds.size && [...coreIds].every((id) => existing.has(id));
  const isEmptySet = existing.size === 0;
  const isCompleteSet = existing.size === documents.length && [...expectedById.keys()].every((id) => existing.has(id));
  if (!existingIdsAreExpected || !existingMatchesOwned || (!isEmptySet && !isAllowedPartialSet && !isCompleteSet)) {
    throw new SafeSeedPublishError("seed_publish_canonical_identity_conflict");
  }
  const rows = documents.map(({ _id, _type }) => ({
    id: _id,
    type: _type,
    operation: existing.has(_id) ? "skip" as const : "create" as const,
  }));
  const toCreate = documents.filter((document) => !existing.has(document._id));
  return {
    rows,
    toCreate,
    canonicalState: toCreate.length === 0 ? "owned" : existing.size === 0 ? "absent" : "partial",
  };
}

function validateManifestAgainstSeed(manifest: SeedPublishManifest, documents: readonly SeedDocument[]): Map<string, ManifestDocument> {
  const expected = new Map(documents.map((document) => [document._id, document]));
  const rows = new Map(manifest.documents.map((row) => [row.id, row]));
  if (expected.size !== documents.length || rows.size !== manifest.documents.length || expected.size !== rows.size) {
    throw new SafeSeedPublishError("seed_publish_manifest_identity_mismatch");
  }
  for (const [id, document] of expected) {
    const row = rows.get(id);
    if (!row || row.type !== document._type || !/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw new SafeSeedPublishError("seed_publish_manifest_identity_mismatch");
  }
  return rows;
}

function validateDraftSnapshot(input: {
  readonly documents: readonly SeedDocument[];
  readonly drafts: ReadonlyMap<string, SanityDocument>;
  readonly manifest: ReadonlyMap<string, ManifestDocument>;
}): void {
  if (input.drafts.size !== input.documents.length) throw new SafeSeedPublishError("seed_publish_draft_set_mismatch");
  for (const expected of input.documents) {
    const id = `drafts.${expected._id}`;
    const actual = input.drafts.get(id);
    const manifest = input.manifest.get(expected._id);
    if (!actual || !manifest || actual._type !== expected._type || actual._rev !== manifest.draftRevision ||
      contentHash(actual) !== manifest.draftContentSha256 || contentHash(actual) !== contentHash(expected)) {
      throw new SafeSeedPublishError("seed_publish_draft_revision_or_content_mismatch");
    }
  }
}

async function writeSafeJson(path: string, value: unknown): Promise<void> {
  const destination = resolveRunPath(path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function safeReport(input: { readonly mode: PublishMode; readonly rows: readonly { readonly id: string; readonly type: string; readonly operation: "create" | "skip" }[]; readonly canonicalState: "absent" | "partial" | "owned" }) {
  return {
    environment: "development",
    mode: input.mode,
    syntheticFixtures: true,
    canonicalState: input.canonicalState,
    documents: input.rows,
    summary: {
      create: input.rows.filter((row) => row.operation === "create").length,
      skip: input.rows.filter((row) => row.operation === "skip").length,
    },
  };
}

export async function runSeedPublisher(argv = process.argv.slice(2), source: EnvironmentSource = process.env) {
  const args = parseSeedPublishArgs(argv);
  const sourceWasInjected = source !== process.env;
  if (!sourceWasInjected) loadLocalEnvironment();
  const environmentSource = ensureLocalDevelopment(sourceWasInjected ? { ...process.env, ...source } : process.env);
  const content = selectComponentTarget("content", environmentSource);
  const writerTarget = selectComponentTarget("seed", environmentSource);
  if (content.mode !== "live" || writerTarget.mode !== "live") throw new SafeSeedPublishError("seed_publish_target_unavailable");
  ensureStudioTarget(environmentSource, content.settings.SANITY_PROJECT_ID, content.settings.SANITY_DATASET);
  const client = createClient({
    projectId: content.settings.SANITY_PROJECT_ID,
    dataset: content.settings.SANITY_DATASET,
    apiVersion: content.settings.SANITY_API_VERSION,
    token: writerTarget.settings.SANITY_SEED_WRITE_TOKEN,
    useCdn: false,
    timeout: 10_000,
    maxRetries: 0,
  });
  const readClient = client.withConfig({ perspective: "raw" });
  const documents = await buildDevelopmentSeedDocuments();
  const expectedTypes = new Map(documents.map((document) => [document._id, document._type]));
  const draftIds = documents.map(({ _id }) => `drafts.${_id}`);
  const canonicalIds = documents.map(({ _id }) => _id);

  if (args.mode === "prepare") {
    const canonical = await fetchDocuments(readClient, canonicalIds);
    const publishedDocuments = documents.map((document) => prepareCanonicalSeedDocument(document, expectedTypes));
    const canonicalPlan = planCanonicalSeedWrites(publishedDocuments, canonical);
    const drafts = await fetchDocuments(readClient, draftIds);
    if (drafts.size !== documents.length) throw new SafeSeedPublishError("seed_publish_draft_set_mismatch");
    const integrityFailures: { readonly id: string; readonly type: string; readonly reason: string; readonly diffPaths?: readonly string[] }[] = [];
    const rows = documents.flatMap((expected): ManifestDocument[] => {
      const actual = drafts.get(`drafts.${expected._id}`);
      if (!actual) { integrityFailures.push({ id: expected._id, type: expected._type, reason: "draft_missing" }); return []; }
      if (actual._type !== expected._type) { integrityFailures.push({ id: expected._id, type: expected._type, reason: "type_mismatch" }); return []; }
      if (typeof actual._rev !== "string") { integrityFailures.push({ id: expected._id, type: expected._type, reason: "revision_missing" }); return []; }
      if (contentHash(actual) !== contentHash(expected)) {
        integrityFailures.push({ id: expected._id, type: expected._type, reason: "seed_content_mismatch", diffPaths: diffPaths(actual, expected) });
        return [];
      }
      return [{ id: expected._id, type: expected._type, draftRevision: actual._rev, draftContentSha256: contentHash(actual) }];
    }).sort((left, right) => left.id.localeCompare(right.id));
    if (integrityFailures.length > 0) {
      const diagnostic = {
        environment: "development",
        mode: "prepare",
        syntheticFixtures: true,
        integrity: { validDrafts: rows.length, failedDrafts: integrityFailures.length },
        failures: integrityFailures,
      };
      await writeSafeJson(args.reportPath, diagnostic);
      process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
      throw new SafeSeedPublishError("seed_publish_draft_not_seed_owned");
    }
    const manifestBase = { version: 1 as const, environment: "development" as const, seedDefinition: "cms-development-fixtures-v1" as const, documents: rows };
    const manifest: SeedPublishManifest = { ...manifestBase, manifestSha256: sha256(manifestPayload(manifestBase)) };
    await writeSafeJson(args.manifestPath, manifest);
    const report = safeReport({ mode: args.mode, canonicalState: canonicalPlan.canonicalState, rows: canonicalPlan.rows });
    await writeSafeJson(args.reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  }

  const manifest = await readManifest(args.manifestPath);
  const manifestRows = validateManifestAgainstSeed(manifest, documents);
  const drafts = await fetchDocuments(readClient, draftIds);
  validateDraftSnapshot({ documents, drafts, manifest: manifestRows });

  const canonical = await fetchDocuments(readClient, canonicalIds);
  const publishedDocuments = documents.map((document) => prepareCanonicalSeedDocument(document, expectedTypes));
  const plan = planCanonicalSeedWrites(publishedDocuments, canonical);
  const report = safeReport({ mode: args.mode, canonicalState: plan.canonicalState, rows: plan.rows });
  if (plan.toCreate.length === 0) {
    await writeSafeJson(args.reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  }
  if (args.mode === "dry-run") {
    await writeSafeJson(args.reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  }

  try {
    let transaction = client.transaction();
    for (const document of plan.toCreate) transaction = transaction.create(document);
    await transaction.commit();
  } catch (error) {
    throw new SafeSeedPublishError(safeSanityFailureCode(error));
  }
  const published = await fetchDocuments(readClient, canonicalIds);
  if (published.size !== publishedDocuments.length || publishedDocuments.some((expected) => {
    const actual = published.get(expected._id);
    return actual?._type !== expected._type || contentHash(actual) !== contentHash(expected);
  })) throw new SafeSeedPublishError("seed_publish_postwrite_verification_failed");
  await writeSafeJson(args.reportPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report;
}

export function isDirectSeedPublisherExecution(metaUrl = import.meta.url): boolean {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}

if (isDirectSeedPublisherExecution()) {
  runSeedPublisher().catch((error: unknown) => {
    const code = error instanceof SafeSeedPublishError || error instanceof SafeConfigurationError ? error.code : "seed_publish_failed";
    process.stderr.write(`Sanity seed publisher failed (${code}).\n`);
    process.exitCode = 1;
  });
}
