import type { LiveEnvironment } from "../config/environment";

const githubApi = "https://api.github.com";

function validRepository(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function validRef(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(value) && !value.includes("..") &&
    !value.includes("//") && !value.endsWith("/") && !value.endsWith(".") && !value.endsWith(".lock");
}

export class DailyDispatchError extends Error {
  readonly code: "daily_dispatch_target_invalid" | "daily_dispatch_forbidden" | "daily_workflow_unavailable" | "daily_dispatch_failed";

  constructor(code: DailyDispatchError["code"]) {
    super(code);
    this.name = "DailyDispatchError";
    this.code = code;
  }
}

/** Dispatches only the checked-in workflow to a statically configured ref and target environment. */
export async function dispatchDailyWorkflow(input: {
  readonly repository: string;
  readonly ref: string;
  readonly token: string;
  readonly environment: LiveEnvironment;
  readonly fetcher?: typeof fetch;
}): Promise<void> {
  if (
    !validRepository(input.repository) || !validRef(input.ref) ||
    !input.token.trim() || /[\r\n]/.test(input.token)
  ) throw new DailyDispatchError("daily_dispatch_target_invalid");
  const [owner, repository] = input.repository.split("/");
  const url = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/daily.yml/dispatches`,
    githubApi,
  );
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(url, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
      },
      body: JSON.stringify({ ref: input.ref, inputs: { environment: input.environment } }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DailyDispatchError("daily_dispatch_failed");
  }
  if (response.status === 403) throw new DailyDispatchError("daily_dispatch_forbidden");
  if (response.status === 404 || response.status === 422) throw new DailyDispatchError("daily_workflow_unavailable");
  if (![200, 201, 202, 204].includes(response.status)) throw new DailyDispatchError("daily_dispatch_failed");
}

export const dailyDispatchInternals = { validRepository, validRef };
