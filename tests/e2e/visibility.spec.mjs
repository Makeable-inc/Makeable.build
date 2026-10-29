// Brief Step 5: hidden, deleted and guessed builds stay private, and nobody can
// change a build that is not theirs. @desktop-only: these check the server, so
// one browser size is enough.
import { expect, test } from "@playwright/test";

import { HIDDEN_BUILD, TEST_USER_BUILDS } from "./fixture-data.mjs";
import { sameOriginHeaders, signIn } from "./helpers.mjs";

test.describe("@desktop-only", () => {
  test("a hidden build is not in the list and its page and picture are not found", async ({ page, request }) => {
    let cursor = "";
    const ids = [];
    do {
      const response = await request.get(`/api/builds?limit=24${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      ids.push(...body.builds.map((build) => build.id));
      cursor = body.nextCursor || "";
    } while (cursor);
    expect(ids).toContain(TEST_USER_BUILDS[0].id);
    expect(ids).not.toContain(HIDDEN_BUILD.id);

    expect((await request.get(`/api/builds/${HIDDEN_BUILD.id}`)).status()).toBe(404);
    expect((await request.get(`/api/builds/${HIDDEN_BUILD.id}/image`)).status()).toBe(404);
    await page.goto(`/app?build=${HIDDEN_BUILD.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(HIDDEN_BUILD.title);
  });

  test("a guessed or deleted build id is not found", async ({ request }) => {
    const guessed = "build_e2e-guessed-id_zzzzzzzzzz";
    expect((await request.get(`/api/builds/${guessed}`)).status()).toBe(404);
    expect((await request.get(`/api/builds/${guessed}/image`)).status()).toBe(404);
  });

  test("a visitor who is not signed in cannot unpublish a build or read an account", async ({ request, baseURL }) => {
    const target = TEST_USER_BUILDS[0];
    const response = await request.delete(`/api/builds/${target.id}`, { headers: sameOriginHeaders(baseURL) });
    expect(response.status()).toBe(401);
    expect((await request.get("/api/account/builds")).status()).toBe(401);
    expect((await request.get(`/api/builds/${target.id}`)).status()).toBe(200);
  });

  test("another signed-in user cannot unpublish someone else's build", async ({ page, baseURL }) => {
    const target = TEST_USER_BUILDS[1];
    await signIn(page, { user: 2 });
    const response = await page.request.delete(`/api/builds/${target.id}`, { headers: sameOriginHeaders(baseURL) });
    expect([403, 404]).toContain(response.status());
    expect((await page.request.get(`/api/builds/${target.id}`)).status()).toBe(200);
  });
});
