// Brief Step 5: every surface of one release opens, does its main thing, loads
// its own files and its links work; the dashboard data is closed to visitors
// and open with the key.
import { expect, test } from "./test.mjs";

import { DASHBOARD_ACCESS_KEY, NEWEST_PUBLIC_BUILD } from "./fixture-data.mjs";
import { communityCard, expectCommunityBuildsShown, primaryNav, unexpectedProblems, watchPage } from "./helpers.mjs";

test("main site: opens, and a community build opens from the gallery", async ({ page }) => {
  const problems = watchPage(page);
  await page.goto("/");
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
  await communityCard(page, NEWEST_PUBLIC_BUILD.title).click();
  await page.waitForURL(`**/app?build=${NEWEST_PUBLIC_BUILD.id}`);
  await expect(page.getByRole("heading", { level: 1, name: NEWEST_PUBLIC_BUILD.title })).toBeVisible();
  expect(unexpectedProblems(problems)).toEqual([]);
});

// The nav links are hidden below 1060 px (the phone menu replaces them).
test("main site: the nav links go to their sections @desktop-only", async ({ page }) => {
  // The site scrolls smoothly to a section, and a smooth scroll can stop short
  // on a busy machine. With reduced motion it jumps there, as the site's own
  // CSS allows, so the test checks where the link goes, not the animation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const problems = watchPage(page);
  await page.goto("/");
  await expectCommunityBuildsShown(page, NEWEST_PUBLIC_BUILD.title);
  const nav = primaryNav(page);
  const sections = [
    { link: "Community", hash: "#community", heading: "Made with Makeable" },
    { link: "Create", hash: "#make", heading: "Create your own build." },
    { link: "Builds", hash: "#builds", heading: "Builds to get you started" },
  ];
  for (const { link, hash, heading } of sections) {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeInViewport();
  }
  expect(unexpectedProblems(problems)).toEqual([]);
});

test("builder: /app opens a build, and its Code tab opens and goes back", async ({ page }) => {
  const problems = watchPage(page);
  await page.goto(`/app?build=${NEWEST_PUBLIC_BUILD.id}`);
  const title = page.getByRole("heading", { level: 1, name: NEWEST_PUBLIC_BUILD.title });
  await expect(title).toBeVisible();
  const areas = page.getByRole("navigation", { name: "Project areas" });
  await expect(areas.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "true");

  // Fixture builds have no wiring, so Code is the tab that opens its own view.
  await areas.getByRole("button", { name: "Code" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Coming soon" })).toBeVisible();
  await expect(title).toBeHidden();
  await expect(areas.getByRole("button", { name: "Code" })).toHaveAttribute("aria-current", "true");

  await page.getByRole("button", { name: "Back to overview" }).click();
  await expect(title).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming soon" })).toBeHidden();
  expect(unexpectedProblems(problems)).toEqual([]);
});

test("Ember: the product page opens, every picture loads and its links work", async ({ page, baseURL }) => {
  const problems = watchPage(page);
  await page.goto("/ember");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Scroll to the end in steps so the lazy pictures load too.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = page.viewportSize().height;
  for (let y = 0; y < height; y += step) {
    await page.mouse.wheel(0, step);
  }
  await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete))).toBe(true);
  const brokenImages = await page.evaluate(() =>
    [...document.images].filter((image) => image.naturalWidth === 0).map((image) => image.src),
  );
  expect(brokenImages).toEqual([]);

  // Links to this site must answer; links elsewhere are only checked to be
  // well-formed, so the test never goes on the internet.
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((link) => link.href));
  expect(hrefs.length).toBeGreaterThan(0);
  const origin = new URL(baseURL).origin;
  const ownPages = new Set();
  for (const href of hrefs) {
    const url = new URL(href);
    if (url.origin === origin) {
      url.hash = "";
      ownPages.add(url.href);
    } else {
      expect(["https:", "mailto:"], href).toContain(url.protocol);
    }
  }
  for (const url of ownPages) {
    expect((await page.request.get(url)).status(), url).toBeLessThan(400);
  }
  expect(unexpectedProblems(problems)).toEqual([]);
});

// Every dashboard endpoint in netlify/functions/api.mjs.
const READ_ENDPOINTS = ["/api/dashboard", "/api/dashboard/export", "/api/dashboard/social"];
// These write data, call TikTok, YouTube or Instagram, or start a sign-in with
// them, so they are only checked to refuse a visitor.
const ACTION_ENDPOINTS = [
  "/api/dashboard/social",
  "/api/dashboard/social/refresh-public",
  "/api/dashboard/social/tiktok/connect",
  "/api/dashboard/social/youtube/connect",
];
// The sign-in callbacks are not behind the dashboard session; they need a
// signed state from a connect call, so without one they refuse with 400.
const CALLBACK_ENDPOINTS = ["/api/dashboard/tiktok/callback", "/api/dashboard/youtube/callback"];

test.describe("dashboard", () => {
  // Server only, so it runs once.
  test("data is refused to visitors @desktop-only", async ({ request, baseURL }) => {
    for (const path of READ_ENDPOINTS) {
      expect((await request.get(path)).status(), `GET ${path}`).toBe(401);
    }
    for (const path of ACTION_ENDPOINTS) {
      const response = await request.post(path, { headers: { Origin: baseURL }, data: {} });
      expect(response.status(), `POST ${path}`).toBe(401);
    }
    for (const path of CALLBACK_ENDPOINTS) {
      const response = await request.get(`${path}?code=guessed&state=guessed`);
      expect(response.status(), `GET ${path}`).toBe(400);
    }
  });

  test("a wrong key is refused and the right key opens the data", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Private dashboard" })).toBeVisible();
    const accessKey = page.getByRole("textbox", { name: "Access key" });
    await accessKey.fill("wrong-access-key");
    await accessKey.press("Enter");
    await expect(page.getByRole("alert")).toHaveText(/\S/);

    await accessKey.fill(DASHBOARD_ACCESS_KEY);
    await accessKey.press("Enter");
    await expect(page.getByRole("heading", { name: "Private dashboard" })).toBeHidden();
    // The test server has no PostHog key, so the social report says
    // "not connected" instead of calling PostHog.
    for (const path of READ_ENDPOINTS) {
      expect((await page.request.get(path)).status(), `GET ${path}`).toBe(200);
    }
  });
});
