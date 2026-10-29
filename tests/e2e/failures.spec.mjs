// Brief Step 5: a failing account or Google script never hides public builds,
// and a failing public list is a retryable error, never "no builds".
import { expect, test } from "@playwright/test";

import { NEWEST_PUBLIC_BUILD } from "./fixture-data.mjs";
import { expectCommunityBuildsShown } from "./helpers.mjs";

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

    await page.goto("/app/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/My builds/);
  });
}

test("public builds still show when the Google sign-in script is blocked", async ({ page }) => {
  await page.route("https://accounts.google.com/**", (route) => route.abort());
  await page.goto("/");
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
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
    const community = page.locator("#community");
    await expect(community).toContainText("Makeable could not load the community builds.");
    failing = false;
    await community.getByRole("button", { name: "Try again" }).click();
    await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
    await expect(community).not.toContainText("could not load");
  });
}

test("when the community list never answers, the homepage gives up and offers Try again", async ({ page }) => {
  await page.route("**/api/builds?**", () => {});
  await page.goto("/");
  // The list request has a 10 s limit.
  await expect(page.locator("#community")).toContainText("Makeable could not load the community builds.", { timeout: 20_000 });
  await expect(page.locator("#community").getByRole("button", { name: "Try again" })).toBeEnabled();
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
