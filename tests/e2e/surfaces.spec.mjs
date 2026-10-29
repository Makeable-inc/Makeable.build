// Brief Step 5: every surface of one release opens, does its main thing, and
// loads its own files; the dashboard is closed to visitors and open with the key.
import { expect, test } from "@playwright/test";

import { DASHBOARD_ACCESS_KEY, NEWEST_PUBLIC_BUILD } from "./fixture-data.mjs";
import { expectCommunityBuildsShown, unexpectedProblems, watchPage } from "./helpers.mjs";

test("main site: opens, and a community build opens from the gallery", async ({ page }) => {
  const problems = watchPage(page);
  await page.goto("/");
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
  await page.locator(".mk-community-card", { hasText: NEWEST_PUBLIC_BUILD.title }).click();
  await page.waitForURL(`**/app?build=${NEWEST_PUBLIC_BUILD.id}`);
  await expect(page.getByRole("heading", { level: 1, name: NEWEST_PUBLIC_BUILD.title })).toBeVisible();
  expect(unexpectedProblems(problems)).toEqual([]);
});

test("builder: /app opens a build with its tabs", async ({ page }) => {
  const problems = watchPage(page);
  await page.goto(`/app?build=${NEWEST_PUBLIC_BUILD.id}`);
  await expect(page.getByRole("heading", { level: 1, name: NEWEST_PUBLIC_BUILD.title })).toBeVisible();
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
  expect(unexpectedProblems(problems)).toEqual([]);
});

test("Ember: the product page opens with its pictures and links", async ({ page }) => {
  const problems = watchPage(page);
  await page.goto("/ember");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const brokenImages = await page.evaluate(() =>
    [...document.images].filter((image) => image.complete && image.naturalWidth === 0 && image.loading !== "lazy").map((image) => image.src),
  );
  expect(brokenImages).toEqual([]);
  expect(unexpectedProblems(problems)).toEqual([]);
});

test.describe("dashboard", () => {
  test("is closed to visitors and opens with the access key", async ({ page, request }) => {
    expect((await request.get("/api/dashboard/export")).status()).toBe(401);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Private dashboard" })).toBeVisible();
    const accessKey = page.getByRole("textbox", { name: "Access key" });
    await accessKey.fill("wrong-access-key");
    await accessKey.press("Enter");
    await expect(page.locator("#authError")).not.toBeEmpty();

    await accessKey.fill(DASHBOARD_ACCESS_KEY);
    await accessKey.press("Enter");
    await expect(page.getByRole("heading", { name: "Private dashboard" })).toBeHidden();
    expect((await page.request.get("/api/dashboard/export")).status()).toBe(200);
  });
});
