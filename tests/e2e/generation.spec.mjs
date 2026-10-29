// Brief Step 5 (line 147): a build test that always behaves the same and costs
// nothing. A signed-in user types an idea and gets a saved build. Everything
// between the browser and the AI is our real code: the start route, the
// background pipeline and its rule checks, the parts' 3D model checks, the
// picture, the server-side save to the owner and the browser's claim. Only
// the outside services are replaced: the AI's answers are replayed from one
// real build (RECORDED_BUILD.recording, see scripts/dev-local-outside.mjs),
// and any other outside request fails.
// @desktop-only: one build per run is enough; the UI sizes are covered elsewhere.
import { expect, test } from "./test.mjs";

import { BUILD_USER, RECORDED_BUILD } from "./fixture-data.mjs";
import { openProjectSwitcher, sameOriginHeaders, signIn } from "./helpers.mjs";

test.describe("@desktop-only", () => {
  test("a typed idea becomes a finished build in My projects and uses one credit", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const api = page.request;
    await api.delete("/__outside-calls");
    await signIn(page, { user: 3 });

    const before = await (await api.get("/api/account")).json();
    expect(before.user.name).toBe(BUILD_USER.name);

    // The job states the page sees while it waits.
    const states = [];
    page.on("response", async (response) => {
      if (/\/api\/build-jobs\/job_[^/]+$/.test(new URL(response.url()).pathname) && response.ok()) {
        states.push((await response.json().catch(() => ({}))).job?.state);
      }
    });

    let buildId = "";
    try {
      await page.getByLabel("Describe what you want to build").fill(RECORDED_BUILD.idea);
      await page.getByRole("button", { name: "Generate build" }).click();

      // Progress while the pipeline runs.
      const steps = page.getByRole("list", { name: "Generation steps" });
      await expect(steps).toBeVisible();
      await expect(steps.getByText("Plan your build")).toBeVisible();

      // The finished build opens on its own page.
      await expect(page).toHaveURL(/\/app\?build=build_a-desk-thermometer/, { timeout: 60_000 });
      buildId = new URL(page.url()).searchParams.get("build");
      await expect(page.getByRole("heading", { name: RECORDED_BUILD.title, level: 1 })).toBeVisible({ timeout: 15_000 });
      expect(states).toContain("ready");
      expect(states.some((state) => ["queued", "planning", "fitting_parts", "rendering"].includes(state))).toBe(true);

      // Saved to this account: listed in My projects, one credit used.
      // Earlier runs on this server (--repeat-each) left builds with the same
      // title, so count them: one more than before, and the open one is it.
      const sameTitle = (builds) => builds.filter((entry) => entry.title === RECORDED_BUILD.title).length;
      const switcher = await openProjectSwitcher(page);
      await expect(switcher.getByRole("button", { name: RECORDED_BUILD.title, exact: true }))
        .toHaveCount(sameTitle(before.builds) + 1);
      await expect(switcher.locator("button[aria-current=true]")).toHaveText(RECORDED_BUILD.title);
      const after = await (await api.get("/api/account")).json();
      expect(after.builds.map((build) => build.id)).toContain(buildId);
      expect(after.quota.used).toBe(before.quota.used + 1);
      expect(after.quota.remaining).toBe(before.quota.remaining - 1);

      // The public build is the pipeline's output, bound to this request:
      // the recorded parts, the maker's name, its identity and its picture.
      const { build } = await (await api.get(`/api/builds/${buildId}`)).json();
      expect(build.makerName).toBe(BUILD_USER.name);
      expect(build.identity).toMatchObject({ buildId });
      expect(build.manifest).toBeTruthy();
      for (const part of RECORDED_BUILD.parts) {
        expect(build.parts.map((entry) => entry.name).join("\n")).toContain(part);
      }
      const image = await api.get(`/api/builds/${buildId}/image`);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toMatch(/^image\//);

      // Every AI and 3D model request had a recorded answer; none went to
      // the network, and nothing else was asked.
      const { calls, misses } = await (await api.get("/__outside-calls")).json();
      expect(misses).toEqual([]);
      const recorded = calls.filter((call) => ["openai", "models"].includes(call.service));
      expect(recorded.every((call) => call.answeredBy === "recording")).toBe(true);
      expect(calls.filter((call) => call.service === "openai").map((call) => call.format || call.path).sort()).toEqual([
        "/v1/images/generations",
        "makeable_assembly_presentation",
        "makeable_build_plan",
      ]);
      expect(calls.filter((call) => call.service === "models")).toHaveLength(2);
    } finally {
      // Unpublish it, so the community list stays the fixed fixture list for
      // the other tests.
      if (buildId) {
        const hidden = await api.delete(`/api/builds/${buildId}`, { headers: sameOriginHeaders(baseURL) });
        expect(hidden.status()).toBe(200);
      }
    }
  });

  test("a build is saved to the account even if the browser leaves before it finishes", async ({ context, page, baseURL }) => {
    test.setTimeout(90_000);
    const api = context.request;
    await signIn(page, { user: 3 });
    const before = await (await api.get("/api/account")).json();

    const started = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/build-jobs" && response.request().method() === "POST");
    await page.getByLabel("Describe what you want to build").fill(RECORDED_BUILD.idea);
    await page.getByRole("button", { name: "Generate build" }).click();
    const { job } = await (await started).json();
    // The tab closes mid-build, so the browser never claims it.
    await page.close();

    let buildId = "";
    try {
      await expect.poll(async () => (await (await api.get(`/api/build-jobs/${job.id}`)).json()).job?.state, {
        timeout: 60_000,
      }).toBe("ready");
      const after = await (await api.get("/api/account")).json();
      const saved = after.builds.filter((build) => !before.builds.some((old) => old.id === build.id));
      expect(saved.map((build) => build.title)).toEqual([RECORDED_BUILD.title]);
      buildId = saved[0].id;
      expect(after.quota.used).toBe(before.quota.used + 1);
      expect((await api.get(`/api/builds/${buildId}`)).status()).toBe(200);
    } finally {
      if (buildId) {
        const hidden = await api.delete(`/api/builds/${buildId}`, { headers: sameOriginHeaders(baseURL) });
        expect(hidden.status()).toBe(200);
      }
    }
  });
});
