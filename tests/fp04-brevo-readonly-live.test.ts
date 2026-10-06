import { expect, it } from "vitest";
import { brevoRequest, requireSafe, selectDevelopmentCrmTarget } from "./fp04-brevo-live-helpers";

const enabled = process.env.PKGCOMPASS_BREVO_LIVE_SMOKE === "tests/fp04-brevo-readonly-live.test.ts";

it.skipIf(!enabled)("verifies development request list and custom attributes (read only)", async () => {
  const target = selectDevelopmentCrmTarget(process.env);
  const listId = Number(target.settings.BREVO_REQUEST_LIST_ID);
  const [listResult, attributesResult] = await Promise.all([
    brevoRequest(target, "GET", `/contacts/lists/${listId}`),
    brevoRequest(target, "GET", "/contacts/attributes"),
  ]);
  expect(listResult.status, "brevo_list_http_status").toBe(200);
  expect(attributesResult.status, "brevo_attributes_http_status").toBe(200);

  const list = listResult.body;
  const listName = typeof list?.name === "string" ? list.name : "";
  const developmentRequestList = list?.id === listId &&
    /pkgcompass.*requests?/i.test(listName) &&
    /\bdev(?:elopment)?\b/i.test(listName) &&
    !/\bprod(?:uction)?\b/i.test(listName);
  expect(developmentRequestList, "brevo_development_request_list_mismatch").toBe(true);

  const attributes = attributesResult.body?.attributes;
  requireSafe(Array.isArray(attributes), "brevo_attributes_shape_invalid");
  const required = [
    ["PKG_SCENARIO", "text"],
    ["PKG_CONTACT_PERMISSION_AT", "text"],
    ["PKG_REQUESTED_AT", "date"],
  ] as const;
  const allAttributesValid = required.every(([name, type]) =>
    attributes.some((attribute) =>
      attribute && typeof attribute === "object" &&
      "name" in attribute && attribute.name === name &&
      "type" in attribute && attribute.type === type &&
      "category" in attribute && attribute.category === "normal",
    ),
  );
  expect(allAttributesValid, "brevo_required_attributes_mismatch").toBe(true);
}, 30_000);
