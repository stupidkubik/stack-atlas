import "server-only";

import { isEventId } from "../../domain/ids";
import { plainDataRecord } from "../../domain/safe-objects";
import type { AppEnvironment } from "../config/environment";

export type SafeReportCode =
  | "adapter_unavailable"
  | "app_env_required"
  | "cms_unavailable"
  | "internal_error"
  | "invalid_app_env"
  | "invalid_configuration"
  | "environment_mismatch"
  | "metrics_unavailable"
  | "missing_configuration";

export interface SafeReport {
  readonly status: 500 | 503;
  readonly code: SafeReportCode;
  readonly environment: AppEnvironment;
  readonly runId?: string;
}

const codes = new Set<SafeReportCode>([
  "adapter_unavailable",
  "app_env_required",
  "cms_unavailable",
  "internal_error",
  "invalid_app_env",
  "invalid_configuration",
  "environment_mismatch",
  "metrics_unavailable",
  "missing_configuration",
]);
const environments = new Set<AppEnvironment>(["fixture", "development", "production"]);

function safeCode(value: unknown): SafeReportCode {
  return typeof value === "string" && codes.has(value as SafeReportCode)
    ? (value as SafeReportCode)
    : "internal_error";
}

function safeEnvironment(value: unknown): AppEnvironment {
  return typeof value === "string" && environments.has(value as AppEnvironment)
    ? (value as AppEnvironment)
    : "fixture";
}

function safeRunId(value: unknown): string | undefined {
  return isEventId(value) ? value : undefined;
}

export function safeReport(input: unknown): SafeReport {
  const record = plainDataRecord(input);
  const code = safeCode(record?.code);
  const status = record?.status === 503 ? 503 : 500;
  const runId = safeRunId(record?.runId);
  return {
    status,
    code,
    environment: safeEnvironment(record?.environment),
    ...(runId ? { runId } : {}),
  };
}

function ownDataCode(error: unknown): unknown {
  try {
    if (!error || typeof error !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor && descriptor.enumerable && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

export function safeReportFromUnknown(
  error: unknown,
  environment: unknown,
  runId?: unknown,
): SafeReport {
  const code = safeCode(ownDataCode(error));
  const safeId = safeRunId(runId);
  return {
    status: code === "internal_error" ? 500 : 503,
    code,
    environment: safeEnvironment(environment),
    ...(safeId ? { runId: safeId } : {}),
  };
}
