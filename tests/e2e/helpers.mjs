import { expect } from "@playwright/test";

// Local test sign-in (scripts/dev-local.mjs only). It also clears the site's
// browser storage, like a fresh browser.
export async function signIn(page, { user = 1, next = "/" } = {}) {
  await page.goto(`/__local-login?${user === 2 ? "user=2&" : ""}next=${encodeURIComponent(next)}`);
}

// Clicks Log out and waits until the server ended the session and the page
// reloaded, so nothing is read from the page before the reload.
export async function logOutWith(page, button) {
  const reloaded = page.waitForEvent("load");
  const ended = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/session") && response.request().method() === "DELETE");
  await button.click();
  expect((await ended).ok()).toBe(true);
  await reloaded;
}

export function communityCard(page, title) {
  return page.locator(".mk-community-card", { hasText: title });
}

export async function expectCommunityBuildsShown(page, title) {
  await expect(communityCard(page, title)).toBeVisible({ timeout: 15_000 });
}

// Collects uncaught page errors and failed same-origin requests during a test.
export function watchPage(page) {
  const problems = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname === "localhost" && response.status() >= 400) {
      problems.push(`${response.status()} ${url.pathname}`);
    }
  });
  return problems;
}

// Visitors get 401 from the account endpoints by design.
export function unexpectedProblems(problems) {
  return problems.filter((problem) => !/^401 \/api\/account(\/builds)?$/.test(problem));
}

export function sameOriginHeaders(baseURL) {
  return { Origin: baseURL, Accept: "application/json" };
}
