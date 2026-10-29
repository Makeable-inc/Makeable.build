// Brief Step 5: a failing account or Google script never hides public builds,
// and a failing public list is a retryable error, never "no builds".
import { expect, test } from "./test.mjs";

import { NEWEST_PUBLIC_BUILD } from "./fixture-data.mjs";
import { communitySection, expectCommunityBuildsShown, primaryNav } from "./helpers.mjs";
import { GOOGLE_SCRIPT } from "./test.mjs";

const accountFaults = {
  "is rejected (401)": (route) => route.fulfill({ status: 401, json: { error: "Sign in" } }),
  "fails (500)": (route) => route.fulfill({ status: 500, json: { error: "boom" } }),
  "returns junk": (route) => route.fulfill({ status: 200, contentType: "application/json", body: "<html>not json" }),
  "never answers": () => {},
};

for (const [fault, handler] of Object.entries(accountFaults)) {
  test(`public builds still show when the account request ${fault}`, async ({ page }) => {
    await page.route("**/api/account", handler);
    await page.goto("/");
    await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);

    // /app falls back to the newest public build, never "My builds".
    await page.goto("/app/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NEWEST_PUBLIC_BUILD.title, { timeout: 15_000 });
  });
}

test("public builds still show when the Google sign-in script is blocked", async ({ page }) => {
  // Every test blocks Google (tests/e2e/test.mjs); this one checks the page
  // really asked for the script and was refused.
  let markBlocked;
  const blocked = new Promise((resolve) => { markBlocked = resolve; });
  await page.route(GOOGLE_SCRIPT, async (route) => {
    await route.abort();
    markBlocked(route.request().url());
  });
  await page.goto("/");
  expect(await blocked).toMatch(/accounts\.google\.com\/gsi\/client/);
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
  await expect(primaryNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
});

const listFaults = {
  "fails (500)": (route) => route.fulfill({ status: 500, json: { error: "boom" } }),
  "returns junk": (route) => route.fulfill({ status: 200, contentType: "application/json", body: "<html>not json" }),
};

for (const [fault, handler] of Object.entries(listFaults)) {
  test(`when the community list ${fault}, the homepage says so and Try again recovers`, async ({ page }) => {
    let failing = true;
    await page.route("**/api/builds?**", (route) => (failing ? handler(route) : route.continue()));
    await page.goto("/");
    const community = communitySection(page);
    await expect(community.getByRole("status")).toHaveText(/could not load/);
    failing = false;
    await community.getByRole("button", { name: "Try again" }).click();
    await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
    await expect(community.getByRole("status")).toHaveCount(0);
  });
}

test("when the community list never answers, the homepage gives up and offers Try again", async ({ page }) => {
  await page.route("**/api/builds?**", () => {});
  await page.goto("/");
  // The list request has a 10 s limit.
  const community = communitySection(page);
  await expect(community.getByRole("status")).toHaveText(/could not load/, { timeout: 20_000 });
  await expect(community.getByRole("button", { name: "Try again" })).toBeEnabled();
});

test("on /app, a failing community list offers Try again and recovers", async ({ page }) => {
  let failing = true;
  await page.route("**/api/builds**", (route) => (failing ? route.fulfill({ status: 500, json: {} }) : route.continue()));
  await page.goto("/app/");
  await expect(page.getByRole("heading", { level: 1, name: "Community builds" })).toBeVisible({ timeout: 15_000 });
  failing = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: NEWEST_PUBLIC_BUILD.title })).toBeVisible();
});
