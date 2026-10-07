export type PosthogSmokeEventName =
  | "page_viewed"
  | "comparison_viewed"
  | "lead_form_viewed"
  | "lead_accepted";

export interface SyntheticPosthogEvent {
  readonly event: PosthogSmokeEventName;
  readonly timestamp: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
}

export interface PosthogLiveSmokeReport {
  readonly environment: "development";
  readonly projectId: "295214";
  readonly status: "pass" | "fail" | "blocked";
  readonly code: string;
  readonly checks: {
    readonly hostRegion: "eu";
    readonly transportAcceptedEventCounts: Readonly<Record<PosthogSmokeEventName, number>>;
    readonly syntheticAcceptedFixtureTransportCount: number;
    readonly realLeadAccepted: 0;
    readonly crmRequests: 0;
    readonly providerPersonProfileMayBeCreated: true;
    readonly payloadPersistedLocally: false;
    readonly syntheticDistinctIdPersistedLocally: false;
    readonly projectTokenPersistedLocally: false;
  };
}

export function attestDevelopmentTarget(input: {
  readonly args: readonly string[];
  readonly processEnv: Record<string, string | undefined>;
  readonly localEnv: Record<string, string | undefined>;
}): { readonly host: string; readonly projectId: "295214"; readonly projectToken: string };

export function createSyntheticJourney(input?: {
  readonly now?: () => number;
  readonly randomUUID?: () => string;
}): readonly SyntheticPosthogEvent[];

export function runPosthogLiveSmoke(input: {
  readonly args: readonly string[];
  readonly processEnv: Record<string, string | undefined>;
  readonly localEnv: Record<string, string | undefined>;
  readonly fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
}): Promise<PosthogLiveSmokeReport>;
