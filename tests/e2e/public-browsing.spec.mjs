// Brief Step 5: a fresh visitor browses public builds without signing in, opens
// one by its link, and an empty list is shown honestly.
import { expect, test } from "./test.mjs";

import { COMMUNITY_BUILDS, NEWEST_PUBLIC_BUILD } from "./fixture-data.mjs";
import { communityCard, communitySection, expectCommunityBuildsShown, primaryNav, unexpectedProblems, watchPage } from "./helpers.mjs";

test("a new visitor sees community builds without signing in", async ({ page }) => {
  const problems = watchPage(page);
  await page.goto("/");
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
  await expect(page.getByRole("dialog", { name: "Log in with Google" })).toBeHidden();
  await expect(primaryNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
  // Example cards stay marked as examples.
  await expect(communitySection(page).getByRole("button", { name: /Makeable example/ }).first()).toBeVisible();
  expect(unexpectedProblems(problems)).toEqual([]);
});

test("the full gallery loads the next page with Load more", async ({ page }) => {
  const lastBuild = COMMUNITY_BUILDS.at(-1);
  await page.goto("/");
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
  await communitySection(page).getByRole("button", { name: /Full gallery/ }).click();
  const gallery = page.getByRole("dialog", { name: "See what others made." });
  await expect(gallery.getByRole("button", { name: new RegExp(NEWEST_PUBLIC_BUILD.title) })).toBeVisible();
  await expect(gallery.getByText(lastBuild.title, { exact: true })).toHaveCount(0);
  await gallery.getByRole("button", { name: "Load more" }).click();
  await expect(gallery.getByText(lastBuild.title, { exact: true })).toBeVisible();
  await expect(gallery.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("a public build opens by its link, with its picture, after a refresh and with back and forward", async ({ page }) => {
  const build = NEWEST_PUBLIC_BUILD;
  await page.goto("/");
  await expectCommunityBuildsShown(page, build.title);
  await page.goto(`/app?build=${build.id}`);
  const heading = page.getByRole("heading", { level: 1, name: build.title });
  await expect(heading).toBeVisible();
  const image = await page.request.get(`/api/builds/${build.id}/image`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toMatch(/^image\//);

  await page.reload();
  await expect(heading).toBeVisible();
  await page.goBack();
  await expect(communityCard(page, build.title)).toBeVisible();
  await page.goForward();
  await expect(heading).toBeVisible();
});

test("an empty community list shows the examples and never says you must sign in to see builds", async ({ page }) => {
  await page.route("**/api/builds?**", (route) => route.fulfill({ json: { builds: [] } }));
  await page.goto("/");
  const community = communitySection(page);
  await expect(community.getByRole("button", { name: /Makeable example/ }).first()).toBeVisible();
  await expect(community.getByRole("status")).toHaveCount(0);
  await expect(community).not.toContainText(/sign in to (see|view)/i);
});
