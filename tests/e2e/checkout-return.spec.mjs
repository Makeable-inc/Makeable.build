import { expect, test } from "./test.mjs";
import { PAYMENTS_PORT } from "./fixture-data.mjs";
const payments = `http://localhost:${PAYMENTS_PORT}`;
test.use({ baseURL: payments });
const returnUrl = (state) => `/?checkout=success&session_id=cs_test_localqc${state}`;

for (const [state, title] of [
  ["paid", "Your Ember pre-order is confirmed."],
  ["pending", "Your payment isn’t confirmed yet."],
  ["error", "We couldn’t verify your payment."],
]) {
  test(`checkout return shows ${state} and can be dismissed`, async ({ page }) => {
    await page.goto(returnUrl(state) + "&keep=this#top");
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await page.locator(".checkout-return").getByRole("button", { name: state === "paid" ? "Continue browsing" : "Close", exact: true }).click();
    await expect(page.locator(".checkout-return")).toHaveCount(0);
    await expect(page).toHaveURL(`${payments}/?keep=this#top`);
  });
}

test("loading is visible before server verification", async ({ page }) => {
  await page.goto(returnUrl("slow"));
  await expect(page.getByRole("heading", { name: "Checking your payment…", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your Ember pre-order is confirmed.", exact: true })).toBeVisible({ timeout: 10000 });
});

test("retry verifies the same session without creating a charge", async ({ page, request }) => {
  let attempts = 0;
  await page.route("**/api/checkout/status?*", (route) => {
    attempts += 1;
    return route.fulfill({ status: attempts === 1 ? 503 : 200, json: attempts === 1 ? { error: "Unavailable" } : { paid: true } });
  });
  await request.delete(`${payments}/__outside-calls`);
  await page.goto(returnUrl("paid"));
  await expect(page.getByRole("heading", { name: "We couldn’t verify your payment.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Ember pre-order is confirmed.", exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  const report = await (await request.get(`${payments}/__outside-calls`)).json();
  expect(report.calls.filter((call) => call.service === "stripe" && call.method === "POST")).toEqual([]);
});

for (const query of ["checkout=success", "checkout=success&session_id=invalid"]) {
  test(`query alone cannot confirm payment: ${query}`, async ({ page }) => {
    await page.goto(`/?${query}`);
    await expect(page.getByRole("heading", { name: "We couldn’t verify your payment.", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your Ember pre-order is confirmed.", exact: true })).toHaveCount(0);
  });
}
test("cancelled checkout does not verify payment", async ({ page }) => {
  let checks = 0;
  page.on("request", (req) => { if (req.url().includes("/api/checkout/status")) checks++; });
  await page.goto("/?checkout=cancelled");
  await expect(page.getByRole("heading", { name: "Checkout was cancelled.", exact: true })).toBeVisible();
  expect(checks).toBe(0);
});
test("ordinary homepage has no payment notice", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".mk-hero")).toBeVisible();
  await expect(page.locator(".checkout-return")).toHaveCount(0);
});

test("confirmation blocks the page until Continue browsing", async ({ page }) => {
  await page.goto(returnUrl("paid"));
  const dialog = page.getByRole("dialog", { name: "Your Ember pre-order is confirmed.", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Continue browsing", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).not.toBeFocused();
  await page.getByRole("button", { name: "Continue browsing", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Pre-order Ember", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Make Ember yours.", exact: true })).toBeVisible();
});
