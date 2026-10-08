import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const origin = "http://127.0.0.1:4317";
const acceptedHeading = "Your request is saved.";

async function fillForm(page: Page) {
  // SSR controls precede hydration; do not let React discard fixture edits.
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form && Object.keys(form).some((key) => key.startsWith("__reactProps") &&
      typeof (form as unknown as Record<string, { onSubmit?: unknown }>)[key]?.onSubmit === "function");
  });
  await page.getByLabel("Email address", { exact: true }).fill("fixture-browser@example.invalid");
  await page.getByLabel("What kind of site are you choosing for?", { exact: true }).selectOption("marketing_site");
  await page.getByRole("checkbox").check();
}

async function assertNoOptionalState(page: Page, context: BrowserContext) {
  expect(await page.evaluate(() => [sessionStorage, localStorage].some((storage) =>
    Object.keys(storage).some((key) => /^(ph_|pkgcompass_campaign|pkgcompass_conversion)/.test(key)),
  ))).toBe(false);
  expect((await context.cookies()).some((cookie) => cookie.name !== "pkgcompass_consent_v1")).toBe(false);
}

test.beforeEach(async ({ context, request }) => {
  const status = await request.get("/api/catalog-status/");
  expect(status.status()).toBe(200);
  expect((await status.json()).environment).toBe("fixture");
  // Every non-loopback browser request fails closed, including analytics.
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) await route.abort();
    else await route.continue();
  });
});

test("direct form accepted and duplicate use real in-memory CRM/DB without analytics", async ({ page, context }) => {
  let externalRequests = 0;
  context.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) externalRequests += 1;
  });
  await page.goto("/en/request-shortlist/");
  await fillForm(page);
  const firstResponse = page.waitForResponse((response) => response.url().endsWith("/api/leads/") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Request a shortlist", exact: true }).click();
  const first = await firstResponse;
  expect(first.status()).toBe(200);
  // Assert only safe projection; never serialize the request body/credential.
  expect((await first.json()).analyticsEligible).toBe(true);
  await expect(page.getByRole("heading", { name: acceptedHeading })).toBeVisible();
  await assertNoOptionalState(page, context);

  await page.getByRole("button", { name: "Reject analytics", exact: true }).click();
  await page.reload();
  await fillForm(page);
  const duplicateResponse = page.waitForResponse((response) => response.url().endsWith("/api/leads/") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Request a shortlist", exact: true }).click();
  const duplicate = await duplicateResponse;
  expect(duplicate.status()).toBe(200);
  expect((await duplicate.json()).analyticsEligible).toBe(false);
  await expect(page.getByRole("heading", { name: acceptedHeading })).toBeVisible();
  await assertNoOptionalState(page, context);
  expect(externalRequests).toBe(0);
});

test("comparison CTA, unavailable and lost-response fixtures preserve retry without analytics", async ({ page, context }) => {
  let externalRequests = 0;
  let attempt = 0;
  let originalCredential: unknown;
  let stableRetry = true;
  context.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) externalRequests += 1;
  });
  // unavailable is the public contract for both CRM and DB failure. Their
  // internal failure provenance is independently covered by service tests.
  await page.route("**/api/leads/", async (route) => {
    const credential: unknown = route.request().postDataJSON().requestId;
    if (attempt === 0) originalCredential = credential;
    else stableRetry &&= credential === originalCredential;
    attempt += 1;
    if (attempt === 3) return route.abort();
    await route.fulfill({ status: attempt < 3 ? 503 : 200, contentType: "application/json",
      body: JSON.stringify(attempt < 3 ? { status: "unavailable" } : {
        status: "accepted", analyticsEligible: true,
        conversionId: "11111111-1111-4111-8111-111111111111",
      }),
    });
  });
  await page.goto("/en/compare/fixture-contentful-vs-fixture-sanity/");
  await expect(page.getByRole("heading", { name: "Synthetic fixture comparison: Sanity and Contentful", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Ask for help choosing between these CMS options", exact: true }).click();
  await expect(page.locator("[data-entry-point]")).toHaveAttribute("data-entry-point", "comparison");
  await fillForm(page);
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Request a shortlist", exact: true }).click();
    await expect(page.locator("#shortlist-error")).toHaveText("We could not confirm your request. Please retry.");
    await expect(page.getByRole("heading", { name: acceptedHeading })).toHaveCount(0);
    await assertNoOptionalState(page, context);
  }
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Request a shortlist", exact: true }).click();
  await expect(page.getByRole("heading", { name: acceptedHeading })).toBeVisible();
  expect(attempt).toBe(4);
  expect(stableRetry).toBe(true);
  await assertNoOptionalState(page, context);
  expect(externalRequests).toBe(0);
});
