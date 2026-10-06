import type { MappingIdentity, MetricObservation } from "../../domain/data-contracts";
import { utcDateTime } from "../../domain/utc";
import { MetricSourceError, requestJson, type HttpJsonOptions } from "./http-json";

interface GitHubRepositoryResponse {
  readonly full_name: string;
  readonly html_url: string;
  readonly stargazers_count: number;
  readonly open_issues_count: number;
  readonly license: null | { readonly spdx_id: string | null; readonly name: string };
}

function safeRepositoryPart(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== "." && value !== "..";
}

function isRepositoryResponse(value: unknown, expected: string): value is GitHubRepositoryResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const license = row.license;
  return row.full_name === expected && typeof row.html_url === "string" &&
    row.html_url === `https://github.com/${expected}` &&
    typeof row.stargazers_count === "number" && Number.isSafeInteger(row.stargazers_count) && row.stargazers_count >= 0 &&
    typeof row.open_issues_count === "number" && Number.isSafeInteger(row.open_issues_count) && row.open_issues_count >= 0 &&
    (license === null || (typeof license === "object" && !Array.isArray(license) &&
      (typeof (license as Record<string, unknown>).spdx_id === "string" || (license as Record<string, unknown>).spdx_id === null) &&
      typeof (license as Record<string, unknown>).name === "string"));
}

function observation(
  mapping: MappingIdentity,
  metric: "stars" | "open_issues" | "license",
  now: Date,
  value: number | string | null,
  status: "ok" | "unknown" | "error",
  reason: string | null,
): MetricObservation {
  const repo = mapping.primaryRepository!;
  const identity = `${repo.owner}/${repo.name}`;
  return {
    productId: mapping.productId,
    source: "github",
    metric,
    sourceEntityId: repo.id,
    sourceIdentity: identity,
    sourceUrl: `https://github.com/${identity}`,
    status,
    reason,
    value,
    observedAt: status === "ok" ? utcDateTime(now.toISOString()) : null,
    fetchedAt: utcDateTime(now.toISOString()),
    periodStart: null,
    periodEnd: null,
    dailySeries: null,
  };
}

export async function collectGitHubMetrics(input: {
  readonly mapping: MappingIdentity;
  readonly now?: Date;
  readonly token?: string;
  readonly request?: (options: HttpJsonOptions) => Promise<unknown>;
  readonly fetcher?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}): Promise<readonly MetricObservation[]> {
  const repo = input.mapping.primaryRepository;
  if (!repo) return [];
  const now = input.now ?? new Date();
  const identity = `${repo.owner}/${repo.name}`;
  if (!safeRepositoryPart(repo.owner) || !safeRepositoryPart(repo.name)) {
    return ["stars", "open_issues", "license"].map((metric) => observation(
      input.mapping, metric as "stars" | "open_issues" | "license", now, null, "error", "source_identity_invalid",
    ));
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  try {
    if (input.token !== undefined && (!input.token.trim() || /[\r\n]/.test(input.token))) {
      throw new MetricSourceError("github_token_invalid");
    }
    const request = input.request ?? requestJson;
    const response = await request({
      url,
      expectedHostname: "api.github.com",
      fetcher: input.fetcher,
      sleep: input.sleep,
      ...(input.token ? { headers: { authorization: `Bearer ${input.token}` } } : {}),
    });
    if (!isRepositoryResponse(response, identity)) throw new MetricSourceError("source_response_invalid");
    const license = response.license?.spdx_id || response.license?.name || null;
    return [
      observation(input.mapping, "stars", now, response.stargazers_count, "ok", null),
      observation(input.mapping, "open_issues", now, response.open_issues_count, "ok", null),
      observation(input.mapping, "license", now, license, license ? "ok" : "unknown", license ? null : "license_not_detected"),
    ];
  } catch (error) {
    const reason = error instanceof MetricSourceError ? error.code : "source_error";
    return ["stars", "open_issues", "license"].map((metric) => observation(
      input.mapping, metric as "stars" | "open_issues" | "license", now, null, "error", reason,
    ));
  }
}

export const githubSourceInternals = { isRepositoryResponse, safeRepositoryPart };
