import "server-only";

import {
  resolveAppEnvironment,
  SafeConfigurationError,
  type AppEnvironment,
  type EnvironmentSource,
  type LiveEnvironment,
} from "./environment";

export const configSettings = {
  content: ["SANITY_PROJECT_ID", "SANITY_DATASET", "SANITY_API_VERSION"],
  metricsReader: ["DATABASE_READ_URL"],
  metricsWriter: ["DATABASE_IMPORT_URL"],
  leadWriter: ["DATABASE_LEAD_URL"],
  databaseMigration: ["DATABASE_MIGRATION_URL"],
  crm: ["BREVO_API_KEY", "BREVO_REQUEST_LIST_ID"],
  measurement: ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST"],
} as const;

export type ConfigComponent = keyof typeof configSettings;
type DatabaseConfigComponent =
  | "metricsReader"
  | "metricsWriter"
  | "leadWriter"
  | "databaseMigration";

const databaseSettings: Record<DatabaseConfigComponent, string> = {
  metricsReader: "DATABASE_READ_URL",
  metricsWriter: "DATABASE_IMPORT_URL",
  leadWriter: "DATABASE_LEAD_URL",
  databaseMigration: "DATABASE_MIGRATION_URL",
};

export interface ComponentSettings {
  readonly content: {
    readonly SANITY_PROJECT_ID: string;
    readonly SANITY_DATASET: string;
    readonly SANITY_API_VERSION: string;
  };
  readonly metricsReader: { readonly DATABASE_READ_URL: string };
  readonly metricsWriter: { readonly DATABASE_IMPORT_URL: string };
  readonly leadWriter: { readonly DATABASE_LEAD_URL: string };
  readonly databaseMigration: { readonly DATABASE_MIGRATION_URL: string };
  readonly crm: {
    readonly BREVO_API_KEY: string;
    readonly BREVO_REQUEST_LIST_ID: string;
  };
  readonly measurement: {
    readonly NEXT_PUBLIC_POSTHOG_KEY: string;
    readonly NEXT_PUBLIC_POSTHOG_HOST: string;
  };
}

export type FixtureTarget<Component extends ConfigComponent = ConfigComponent> = {
  readonly mode: "fixture";
  readonly environment: "fixture";
  readonly component: Component;
};

export type LiveTarget<Component extends ConfigComponent = ConfigComponent> = {
  readonly mode: "live";
  readonly environment: LiveEnvironment;
  readonly component: Component;
  readonly settings: ComponentSettings[Component];
};

export type ComponentTarget<Component extends ConfigComponent = ConfigComponent> =
  | FixtureTarget<Component>
  | LiveTarget<Component>;

function invalid(setting: string): never {
  throw new SafeConfigurationError({ code: "invalid_configuration", setting });
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertValidSettings<Component extends ConfigComponent>(
  component: Component,
  environment: LiveEnvironment,
  values: Record<string, string>,
): asserts values is Record<keyof ComponentSettings[Component] & string, string> {
  if (component === "content") {
    if (!/^[-a-z0-9]+$/i.test(values.SANITY_PROJECT_ID ?? "")) invalid("SANITY_PROJECT_ID");
    if (
      values.SANITY_DATASET !== environment ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(values.SANITY_DATASET ?? "")
    ) invalid("SANITY_DATASET");
    if (!isRealDate(values.SANITY_API_VERSION ?? "")) invalid("SANITY_API_VERSION");
    return;
  }

  if (
    component === "metricsReader" || component === "metricsWriter" ||
    component === "leadWriter" || component === "databaseMigration"
  ) {
    const setting = databaseSettings[component as DatabaseConfigComponent];
    if (!validDatabaseUrl(
      values[setting] ?? "",
      component === "metricsWriter" || component === "databaseMigration",
    )) invalid(setting);
    return;
  }

  if (component === "crm") {
    if (!isSingleLineValue(values.BREVO_API_KEY ?? "")) invalid("BREVO_API_KEY");
    const listId = Number(values.BREVO_REQUEST_LIST_ID);
    if (!/^\d+$/.test(values.BREVO_REQUEST_LIST_ID ?? "") || !Number.isSafeInteger(listId) || listId < 1) {
      invalid("BREVO_REQUEST_LIST_ID");
    }
    return;
  }

  if (component === "measurement") {
    const projectKey = values.NEXT_PUBLIC_POSTHOG_KEY ?? "";
    if (!isSingleLineValue(projectKey) || projectKey.startsWith("phx_")) {
      invalid("NEXT_PUBLIC_POSTHOG_KEY");
    }
    try {
      const host = new URL(values.NEXT_PUBLIC_POSTHOG_HOST ?? "");
      if (
        host.protocol !== "https:" ||
        host.hostname !== "eu.i.posthog.com" ||
        host.username || host.password || host.search || host.hash || host.pathname !== "/"
      ) invalid("NEXT_PUBLIC_POSTHOG_HOST");
    } catch {
      invalid("NEXT_PUBLIC_POSTHOG_HOST");
    }
  }
}

function isSingleLineValue(value: string): boolean {
  return value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validDatabaseUrl(value: string, requiresDirectSession: boolean): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(host);
    const databaseName = url.pathname.slice(1);
    const supportedParameters = new Map([
      ["sslmode", new Set(["require", "verify-full"])],
      ["channel_binding", new Set(["require", "prefer"])],
    ]);
    const hasUnsafeParameters = [...new Set(url.searchParams.keys())].some((key) => {
      const values = url.searchParams.getAll(key);
      const allowedValues = supportedParameters.get(key);
      return !allowedValues || values.length !== 1 || !allowedValues.has(values[0]);
    });

    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      Boolean(host && url.username) && (Boolean(url.password) || isLoopback) &&
      /^[A-Za-z0-9_.-]+$/.test(databaseName) && !url.hash &&
      (isLoopback || ["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) &&
      !(requiresDirectSession && host.includes("-pooler")) && !hasUnsafeParameters;
  } catch {
    return false;
  }
}

function buildTarget<Component extends ConfigComponent>(
  component: Component,
  environment: AppEnvironment,
  source: EnvironmentSource,
): ComponentTarget<Component> {
  if (environment === "fixture") {
    return { mode: "fixture", environment, component };
  }

  const settings = configSettings[component];
  const values: Record<string, string> = {};
  for (const setting of settings) {
    const value = source[setting]?.trim();
    if (!value) {
      throw new SafeConfigurationError({
        code: "missing_configuration",
        component,
        setting,
      });
    }
    values[setting] = value;
  }
  assertValidSettings(component, environment, values);

  return {
    mode: "live",
    environment,
    component,
    settings: values as ComponentSettings[Component],
  };
}

export function selectComponentTarget<Component extends ConfigComponent>(
  component: Component,
  source: EnvironmentSource = process.env,
): ComponentTarget<Component> {
  return buildTarget(component, resolveAppEnvironment(source), source);
}
