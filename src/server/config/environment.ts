import "server-only";

export type AppEnvironment = "fixture" | "development" | "production";
export type LiveEnvironment = Exclude<AppEnvironment, "fixture">;

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export type ConfigurationErrorCode =
  | "invalid_app_env"
  | "app_env_required"
  | "environment_mismatch"
  | "invalid_configuration"
  | "missing_configuration"
  | "adapter_unavailable";

export class SafeConfigurationError extends Error {
  readonly code: ConfigurationErrorCode;
  readonly setting?: string;
  readonly component?: string;

  constructor(input: {
    code: ConfigurationErrorCode;
    setting?: string;
    component?: string;
  }) {
    const description =
      input.code === "invalid_app_env"
        ? "APP_ENV must be fixture, development, or production."
        : input.code === "app_env_required"
          ? "APP_ENV is required in a deployed environment."
          : input.code === "environment_mismatch"
            ? "APP_ENV does not match the trusted deployment environment."
            : input.code === "invalid_configuration"
              ? `Configuration is invalid${input.setting ? `: ${input.setting}` : "."}`
              : input.code === "missing_configuration"
                ? `Required configuration is missing${input.setting ? `: ${input.setting}` : "."}`
                : `The ${input.component ?? "requested"} adapter is unavailable.`;
    super(description);
    this.name = "SafeConfigurationError";
    this.code = input.code;
    this.setting = input.setting;
    this.component = input.component;
  }
}

function isFixtureDefaultContext(source: EnvironmentSource): boolean {
  const hasCi = source.CI === "true" || source.CI === "1";
  const isLocal = !hasCi && !source.VERCEL && !source.VERCEL_ENV;
  const isCi = hasCi && !isTrustedVercelDeployment(source);
  const isUntrustedPullRequest = isExplicitUntrustedPullRequest(source) ||
    (Boolean(source.VERCEL_GIT_PULL_REQUEST_ID?.trim()) && !isTrustedPreview(source));
  return isLocal || isCi || isUntrustedPullRequest;
}

function isUntrustedContext(source: EnvironmentSource): boolean {
  const hasCi = source.CI === "true" || source.CI === "1";
  const isPullRequest = isExplicitUntrustedPullRequest(source) ||
    (Boolean(source.VERCEL_GIT_PULL_REQUEST_ID?.trim()) && !isTrustedPreview(source));
  return isPullRequest || (hasCi && !isTrustedVercelDeployment(source));
}

function isExplicitUntrustedPullRequest(source: EnvironmentSource): boolean {
  return source.GITHUB_EVENT_NAME === "pull_request" || source.PKGCOMPASS_UNTRUSTED_PR === "true";
}

function isTrustedPreview(source: EnvironmentSource): boolean {
  return source.VERCEL === "1" &&
    source.VERCEL_ENV === "preview" &&
    source.PKGCOMPASS_TRUSTED_PREVIEW === "true";
}

function isTrustedVercelDeployment(source: EnvironmentSource): boolean {
  return source.VERCEL === "1" &&
    (source.VERCEL_ENV === "production" || source.VERCEL_ENV === "development" || isTrustedPreview(source));
}

export function resolveAppEnvironment(
  source: EnvironmentSource = process.env,
): AppEnvironment {
  const rawCandidate = source.APP_ENV?.trim();
  const candidate = rawCandidate || undefined;
  let configuredEnvironment: AppEnvironment | undefined;

  if (candidate === "fixture" || candidate === "development" || candidate === "production") {
    configuredEnvironment = candidate;
  } else if (candidate) {
    throw new SafeConfigurationError({ code: "invalid_app_env", setting: "APP_ENV" });
  }

  if (isUntrustedContext(source)) return "fixture";

  const environment = configuredEnvironment ?? (isFixtureDefaultContext(source) ? "fixture" : undefined);
  if (!environment) throw new SafeConfigurationError({ code: "app_env_required", setting: "APP_ENV" });

  const vercelEnvironment = source.VERCEL_ENV;
  if (
    (vercelEnvironment === "production" && environment !== "production") ||
    (vercelEnvironment === "preview" && environment !== "development") ||
    (vercelEnvironment === "development" && environment !== "development")
  ) {
    throw new SafeConfigurationError({ code: "environment_mismatch", setting: "APP_ENV" });
  }
  if (environment === "production" && !(source.VERCEL === "1" && vercelEnvironment === "production")) {
    throw new SafeConfigurationError({ code: "environment_mismatch", setting: "APP_ENV" });
  }

  return environment;
}
