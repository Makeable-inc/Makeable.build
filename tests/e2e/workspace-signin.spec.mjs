import { expect, test } from "./test.mjs";
import { signIn } from "./helpers.mjs";

test("signed-out workspace offers sign in without an avatar or build balance", async ({ page }, testInfo) => {
  await page.goto("/app/");
  const signIn = page.getByRole("link", { name: "Sign in", exact: true });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", "/?signin=1");
  await expect(page.locator(".mk-app-user")).toHaveCount(0);
  await expect(page.getByText(/free builds remaining/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("signed-out-workspace.png") });
  await signIn.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).not.toHaveURL(/signin=/);
});

test("signin return preserves other URL state and opens only once", async ({ page }) => {
  await page.goto("/?signin=1&keep=this#top");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\?keep=this#top$/);
  await page.getByRole("button", { name: "Close login", exact: true }).click();
  await page.reload();
  await expect(page.locator(".mk-hero")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("signed-in visitors do not see a login box for signin=1", async ({ page }) => {
  await signIn(page, { next: "/?signin=1&keep=this" });
  await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/signin=/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
