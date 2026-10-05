import { eventId } from "../../src/domain/ids";
import type { AnalyticsEvent } from "../../src/domain/measurement";
import { utcDateTime } from "../../src/domain/utc";
import { FIXTURE_CATEGORY_ID } from "../../src/server/fixtures/catalog";

export const knownPageView: AnalyticsEvent = {
  eventSchemaVersion: 1,
  environment: "development",
  routeType: "catalog",
  locale: "en",
  occurredAt: utcDateTime("2026-10-05T12:00:00.000Z"),
  eventId: eventId("00000000-0000-4000-8000-000000000001"),
  name: "page_viewed",
  entityId: FIXTURE_CATEGORY_ID,
};
