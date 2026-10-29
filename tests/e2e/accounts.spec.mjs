// Brief Step 5: signed-in users see their own builds and can still browse the
// community; log out and switching accounts leave no private data behind.
import { expect, test } from "@playwright/test";

import { COMMUNITY_BUILDS, NEWEST_PUBLIC_BUILD, SECOND_USER, TEST_USER, TEST_USER_BUILDS } from "./fixture-data.mjs";
import { expectCommunityBuildsShown, logOutWith, signIn } from "./helpers.mjs";

async function signedInName(page) {
  const account = await page.evaluate(() => fetch("/api/account").then((response) => response.json()));
  return account.user?.name ?? null;
}

async function projectSwitcherTitles(page) {
  const switcher = page.locator("details.mk-build-switcher");
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  await switcher.locator("summary").click();
  return switcher.locator("div");
}

test("a signed-in user with builds sees them in My projects and can still browse the community", async ({ page }) => {
  await signIn(page, { next: "/app/" });
  const list = await projectSwitcherTitles(page);
  for (const build of TEST_USER_BUILDS) await expect(list).toContainText(build.title);
  await expect(list).not.toContainText(COMMUNITY_BUILDS[0].title);

  await page.goto("/");
  await expect(page.locator(".mk-nav-cta")).toContainText("My builds");
  await expectCommunityBuildsShown(page, COMMUNITY_BUILDS[0].title);
});

test("a signed-in user with no builds can still browse the community, and nobody else's build is shown as theirs", async ({ page }) => {
  await signIn(page, { user: 2, next: "/app/" });
  const list = await projectSwitcherTitles(page);
  await expect(list).toContainText("No saved builds yet.");
  for (const build of TEST_USER_BUILDS) await expect(list).not.toContainText(build.title);

  await page.goto("/");
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
});

for (const where of ["/", "/app/"]) {
  test(`Log out on ${where} ends the session, clears saved data and keeps the community builds`, async ({ page }) => {
    await signIn(page, { next: where });
    await page.evaluate(() => {
      // Any makeable:* key. Not a saved build id: the homepage would try to reopen it.
      localStorage.setItem("makeable:e2e-saved", "x");
      sessionStorage.setItem("makeable:open-project", "{}");
      localStorage.setItem("unrelated-key", "kept");
    });
    const logOut = where === "/" ? page.locator(".mk-nav-signout") : page.getByRole("button", { name: "Log out" });
    await logOutWith(page, logOut);

    const account = await page.evaluate(() => fetch("/api/account").then((response) => response.json()));
    expect(account.user ?? null).toBeNull();
    const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
    expect(keys.filter((key) => key.startsWith("makeable:"))).toEqual([]);
    expect(keys).toContain("unrelated-key");
    if (where === "/") {
      await expect(page.locator(".mk-nav-cta")).toHaveText("Sign in");
      await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
    }
  });
}

test("after one user logs out, the next user on the browser sees only their own account", async ({ page }) => {
  await signIn(page, { next: "/app/" });
  expect(await signedInName(page)).toBe(TEST_USER.name);
  await logOutWith(page, page.getByRole("button", { name: "Log out" }));

  await signIn(page, { user: 2, next: "/app/" });
  expect(await signedInName(page)).toBe(SECOND_USER.name);
  await expect(page.locator("body")).not.toContainText(TEST_USER.name);
  const list = await projectSwitcherTitles(page);
  for (const build of TEST_USER_BUILDS) await expect(list).not.toContainText(build.title);
});
