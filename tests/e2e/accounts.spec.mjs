// Brief Step 5: signed-in users see their own builds and can still browse the
// community; log out and switching accounts leave no private data behind.
import { expect, test } from "./test.mjs";

import { COMMUNITY_BUILDS, NEWEST_PUBLIC_BUILD, SECOND_USER, TEST_USER, TEST_USER_BUILDS } from "./fixture-data.mjs";
import { expectCommunityBuildsShown, logOutWith, openProjectSwitcher, primaryNav, sameOriginHeaders, signIn } from "./helpers.mjs";

async function signedInName(page) {
  const account = await page.evaluate(() => fetch("/api/account").then((response) => response.json()));
  return account.user?.name ?? null;
}

test("a signed-in user with builds sees them in My projects and can still browse the community", async ({ page }) => {
  await signIn(page, { next: "/app/" });
  const list = await openProjectSwitcher(page);
  for (const build of TEST_USER_BUILDS) await expect(list).toContainText(build.title);
  await expect(list).not.toContainText(COMMUNITY_BUILDS[0].title);

  await page.goto("/");
  await expect(primaryNav(page).getByRole("button", { name: /My builds/ })).toBeVisible();
  await expectCommunityBuildsShown(page, COMMUNITY_BUILDS[0].title);
});

test("a signed-in user with no builds can still browse the community, and nobody else's build is shown as theirs", async ({ page }) => {
  await signIn(page, { user: 2, next: "/app/" });
  const list = await openProjectSwitcher(page);
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
    const logOut = (where === "/" ? primaryNav(page) : page).getByRole("button", { name: "Log out" });
    await logOutWith(page, logOut);

    const account = await page.evaluate(() => fetch("/api/account").then((response) => response.json()));
    expect(account.user ?? null).toBeNull();
    const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
    expect(keys.filter((key) => key.startsWith("makeable:"))).toEqual([]);
    expect(keys).toContain("unrelated-key");
    if (where === "/") {
      await expect(primaryNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
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
  const list = await openProjectSwitcher(page);
  for (const build of TEST_USER_BUILDS) await expect(list).not.toContainText(build.title);
});

// A build job id saved by the homepage while user 1 was building. The server
// does not know it, like a job from another account or one that is gone.
const SAVED_JOB_KEY = "makeable:active-build-job:v1";
const SAVED_JOB_ID = "job_e2eStaleJobFromUser1xx";

// Signs in user 1 and saves the job id on a page that never reads it (the
// homepage would check it at once and drop it, since the server does not know it).
async function saveJobAsUser1(page) {
  await signIn(page, { next: "/ember" });
  await page.evaluate(([key, id]) => localStorage.setItem(key, id), [SAVED_JOB_KEY, SAVED_JOB_ID]);
}

// Ends the session on the server without Log out: the browser keeps its old
// cookie and saved data, as when a session expires.
async function expireSession(page, baseURL) {
  const cookies = await page.context().cookies();
  const response = await page.request.delete("/api/auth/session", { headers: sameOriginHeaders(baseURL) });
  expect(response.ok()).toBe(true);
  await page.context().addCookies(cookies);
  expect(await signedInName(page)).toBeNull();
}

test("when a session expires, the homepage shows the community builds and Sign in, not an unfinished build", async ({ page, baseURL }) => {
  await saveJobAsUser1(page);
  await expireSession(page, baseURL);
  const jobRequests = [];
  page.on("request", (request) => { if (request.url().includes(SAVED_JOB_ID)) jobRequests.push(request.url()); });

  await page.goto("/");
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
  await expect(primaryNav(page).getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("This build did not finish")).toHaveCount(0);
  // Signed out, the saved build is not reopened at all.
  expect(jobRequests).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVED_JOB_KEY)).toBe(SAVED_JOB_ID);
});

test("after a session expires, the next user to sign in is not stuck on the old user's build", async ({ page, baseURL }) => {
  await saveJobAsUser1(page);
  await expireSession(page, baseURL);

  // keep=1: a sign-in that leaves the browser's saved data alone, like Google's.
  const jobChecked = page.waitForResponse((response) => response.url().includes(SAVED_JOB_ID));
  await page.goto("/__local-login?user=2&keep=1&next=/");
  expect([403, 404]).toContain((await jobChecked).status());
  await expect(primaryNav(page).getByRole("button", { name: /My builds/ })).toBeVisible({ timeout: 15_000 });
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
  await expect(page.getByText("This build did not finish")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), SAVED_JOB_KEY)).toBeNull();
  expect(await signedInName(page)).toBe(SECOND_USER.name);
});
