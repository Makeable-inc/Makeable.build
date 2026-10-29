import { expect } from "@playwright/test";

// Local test sign-in (scripts/dev-local.mjs only). It also clears the site's
// browser storage, like a fresh browser.
export async function signIn(page, { user = 1, next = "/" } = {}) {
  await page.goto(`/__local-login?${user > 1 ? `user=${user}&` : ""}next=${encodeURIComponent(next)}`);
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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The homepage's "Made with Makeable" section.
export function communitySection(page) {
  return page.getByRole("region", { name: "Made with Makeable" });
}

// A community card is a button whose name includes its title. The page dots
// below the cards are named "Show <title>", so those are left out.
export function communityCard(page, title) {
  return communitySection(page).getByRole("button", { name: new RegExp(`^(?!Show ).*\\b${escapeRegExp(title)}\\b`) });
}

// The homepage nav: "Sign in" or "My builds", and Log out when signed in.
export function primaryNav(page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

// The /app project switcher (a details element; its summary says "My projects").
export async function openProjectSwitcher(page) {
  const summary = page.locator("summary", { hasText: "My projects" });
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await summary.click();
  return page.locator("details", { has: summary });
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
