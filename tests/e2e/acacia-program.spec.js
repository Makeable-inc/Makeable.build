import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import {
  createAcaciaProgramResponse,
  createAcaciaProposal,
} from "../../lib/programs/acacia/service.mjs";

const ACACIA_PATH = "/pilot?program=acacia";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installApiMocks(page, options = {}) {
  const calls = {
    manifest: 0,
    proposals: [],
    accepts: [],
    acaciaPaths: [],
    openai: [],
  };

  await page.route("**/api/config", (route) =>
    fulfillJson(route, {
      hasAccounts: false,
      hasOpenAIKey: false,
      hasGithubToken: false,
      apiBaseUrl: "",
    }),
  );
  await page.route("**/api/esp32/status", (route) =>
    fulfillJson(route, {
      hasEsp32Compiler: true,
      hasEsp32Core: true,
    }),
  );
  await page.route("**/api/programs/nus-acacia", (route) => {
    calls.manifest += 1;
    calls.acaciaPaths.push(new URL(route.request().url()).pathname);
    return fulfillJson(route, createAcaciaProgramResponse());
  });
  await page.route("**/api/programs/nus-acacia/proposals", async (route) => {
    const body = route.request().postDataJSON();
    calls.proposals.push(body);
    calls.acaciaPaths.push(new URL(route.request().url()).pathname);

    if (options.onProposal) {
      await options.onProposal({ route, body, ordinal: calls.proposals.length });
      return;
    }

    const response = createAcaciaProposal(body);
    await fulfillJson(route, response, response.ok ? 200 : response.status || 400);
  });
  await page.route("**/api/programs/nus-acacia/plans/*/accept", async (route) => {
    calls.accepts.push(route.request().postDataJSON());
    calls.acaciaPaths.push(new URL(route.request().url()).pathname);
    await fulfillJson(route, {
      ok: false,
      error: "Acceptance is intentionally disabled in this proposal-only browser test.",
    }, 503);
  });
  await page.route("**/api/openai/**", (route) => {
    calls.openai.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postData(),
    });
    return fulfillJson(route, { error: "Unexpected AI request in Acacia proposal test." }, 503);
  });

  return calls;
}

async function openAcacia(page) {
  await page.goto(ACACIA_PATH);
  await expect(page.locator("#programBadge")).toBeVisible();
  await expect(page.locator("#programBadge")).toHaveText("Acacia College");
  await expect.poll(() =>
    page.evaluate(() => location.pathname + location.search + location.hash),
  ).toBe("/pilot?program=acacia#capture");
}

async function requestIdea(page, idea) {
  await page.locator("#ideaText").fill(idea);
  await page.locator("#ideaNextButton").click();
  await expect(page.locator("#acaciaPlanResult")).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => location.pathname + location.search + location.hash),
  ).toBe("/pilot?program=acacia#plan");
}

test("idea-first Acacia routing reaches a core-only Plan without asking for a photo", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop covers the proposal contract.");
  const calls = await installApiMocks(page);
  await openAcacia(page);

  await requestIdea(page, "Help residents notice when the common room is too hot.");

  await expect(page.locator("#acaciaPlanPanel")).toHaveAttribute("data-plan-feasibility", "ready");
  await expect(page.locator("#acaciaPlanPanel")).toHaveAttribute("data-build-route", "rules");
  await expect(page.locator('[data-part-group="core"]')).toContainText(
    "BME280 temperature, humidity and pressure sensor",
  );
  await expect(page.locator('[data-part-group="core"]')).toContainText(
    "SSD1306 128×64 OLED display",
  );
  await expect(page.locator('[data-part-group="core"] li')).toHaveCount(6);
  expect(
    await page.locator('[data-part-group="core"] li').evaluateAll((items) =>
      items.every((item) => item.dataset.availability === "included"),
    ),
  ).toBe(true);
  await expect(page.locator('[data-part-group="shared"] li')).toHaveCount(0);
  await expect(page.locator("#acaciaNoSharedParts")).toBeVisible();
  await expect(page.locator("#acaciaNoSharedParts")).toContainText("Nothing extra needed");
  await expect(page.locator("#partsPhotoInput")).not.toBeVisible();
  await expect(page.locator("#planPrivacyNote")).toContainText("No parts photo needed");

  expect(calls.proposals).toEqual([
    { idea: "Help residents notice when the common room is too hot." },
  ]);
  expect(calls.accepts).toEqual([]);
  expect(calls.openai).toEqual([]);
});

test("the nus-acacia alias survives Acacia stage navigation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop covers URL context preservation.");
  await installApiMocks(page);
  await page.goto("/pilot?program=nus-acacia");
  await expect.poll(() =>
    page.evaluate(() => location.pathname + location.search + location.hash),
  ).toBe("/pilot?program=nus-acacia#capture");

  await page.locator("#ideaText").fill("Show residents when the common room is too warm.");
  await page.locator("#ideaNextButton").click();
  await expect(page.locator("#acaciaPlanResult")).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => location.pathname + location.search + location.hash),
  ).toBe("/pilot?program=nus-acacia#plan");
});

test("camera identification is visibly reshaped while the original goal stays traceable", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop covers the reshape contract.");
  await installApiMocks(page);
  await openAcacia(page);

  const idea = "Use face recognition camera footage to identify every visitor.";
  await requestIdea(page, idea);

  await expect(page.locator("#acaciaPlanResult")).toHaveAttribute("data-plan-status", "reshaped");
  await expect(page.locator("#acaciaFitBadge")).toContainText("Goal preserved");
  await expect(page.locator("#acaciaOriginalIdea")).toHaveText(idea);
  await expect(page.locator("[data-preserved-intent]")).toHaveText(idea);
  await expect(page.locator("[data-deferred-feature]")).toContainText(
    "Replace camera-based identification",
  );
  await expect(page.locator("#acaciaAdaptationReason")).toContainText(
    "privacy-friendly presence and distance sensing",
  );
  await expect(page.locator("#acaciaAdaptationReason")).toContainText(
    "does not make identity claims",
  );
  await expect(page.locator("#acaciaFeasibleSummary")).toContainText(
    "without capturing images or identifying a person",
  );
  expect(
    await page.locator("[data-part-group] li").evaluateAll((items) =>
      items.every((item) => !/camera/i.test(`${item.dataset.partId} ${item.textContent}`)),
    ),
  ).toBe(true);
});

test("an Advanced proximity build presents only the qualified PIR as a shared checkout item", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop covers the shared-pool contract.");
  await installApiMocks(page);
  await openAcacia(page);

  await requestIdea(page, "Notice a nearby visitor with a distance alert.");
  await page.locator('[data-acacia-difficulty="advanced"]').click();

  await expect(page.locator('[data-acacia-difficulty="advanced"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#acaciaPlanPanel")).toHaveAttribute("data-build-route", "rules");
  const sharedParts = page.locator('[data-part-group="shared"] li');
  await expect(sharedParts).toHaveCount(1);
  const pir = page.locator(
    '[data-part-group="shared"] [data-part-id="hc-sr501-pir"]',
  );
  await expect(pir).toBeVisible();
  await expect(pir).toHaveAttribute("data-availability", "checkout_required");
  await expect(pir).toContainText("HC-SR501 passive infrared motion sensor");
  await expect(pir).toContainText("reserve from Acacia’s shared advanced pool");
  expect(
    await page.locator("[data-part-group] li").evaluateAll((items) =>
      items.every((item) =>
        !/ws2812|servo|pn532|motor|driver|supply|pump/i.test(
          `${item.dataset.partId} ${item.textContent}`,
        ),
      ),
    ),
  ).toBe(true);
});

test("an Advanced override starts a second request and a stale first response cannot win", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop covers the request-race contract.");
  const firstResponseGate = deferred();
  const firstResponseSettled = deferred();
  const calls = await installApiMocks(page, {
    async onProposal({ route, body, ordinal }) {
      const response = createAcaciaProposal(body);
      if (ordinal === 1) {
        await firstResponseGate.promise;
        try {
          await fulfillJson(route, response);
        } catch {
          // The browser is expected to abort this request when the override starts.
        } finally {
          firstResponseSettled.resolve();
        }
        return;
      }
      await fulfillJson(route, response);
    },
  });
  await openAcacia(page);

  await page.locator("#ideaText").fill("Make a room temperature status light.");
  await page.locator("#ideaNextButton").click();
  await expect.poll(() => calls.proposals.length).toBe(1);

  await page.evaluate(() => {
    document.querySelector('[data-acacia-difficulty="advanced"]').click();
  });
  await expect.poll(() => calls.proposals.length).toBe(2);
  expect(calls.proposals[0]).toEqual({ idea: "Make a room temperature status light." });
  expect(calls.proposals[1]).toEqual({
    idea: "Make a room temperature status light.",
    difficulty: "advanced",
  });

  const advancedButton = page.locator('[data-acacia-difficulty="advanced"]');
  await expect(page.locator("#acaciaPlanResult")).toBeVisible();
  await expect(advancedButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#acaciaDifficultyReason")).toContainText("You selected Advanced");
  await expect(page.locator("#acaciaDifficultyReason")).toContainText(
    "Makeable recommends Beginner for the first pass",
  );

  firstResponseGate.resolve();
  await firstResponseSettled.promise;
  await expect.poll(() =>
    page.evaluate(() =>
      window.__MAKEABLE_TEST_API__.getProgramState().proposal?.proposal?.difficulty,
    ),
  ).toBe("advanced");
  await expect(advancedButton).toHaveAttribute("aria-pressed", "true");
});

test("TinyML stops at sensor verification and labeled data collection with no student API-key field", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop covers the TinyML copy contract.");
  const calls = await installApiMocks(page);
  await openAcacia(page);

  await requestIdea(page, "Collect motion examples and classify three hand gestures.");

  await expect(page.locator("#acaciaPlanPanel")).toHaveAttribute("data-build-route", "tinyml");
  await expect(page.locator("#acaciaPlanResult")).toHaveAttribute(
    "data-plan-status",
    "reshaped",
  );
  await expect(page.locator("#acaciaRouteLabel")).toHaveText("TinyML data preparation");
  await expect(page.locator("#acaciaRouteReason")).toContainText(
    "verifying the sensor and collecting labeled examples",
  );
  await expect(page.locator("#acaciaRouteReason")).toContainText(
    "only claimed after it is trained and validated",
  );
  await expect(page.locator("[data-deferred-feature]")).toContainText(
    "defer model training, packaging and on-device inference",
  );
  await expect(page.locator("#acaciaCapabilities")).toContainText(
    "Collect labeled examples for the chosen classes",
  );
  await expect(page.locator("#acaciaCapabilities")).toContainText(
    "Train and validate a model before claiming on-device prediction",
  );
  await expect(page.locator('[data-part-id="mpu6050-imu"]')).toBeVisible();
  await expect(page.locator('[data-part-id="ssd1306-oled"]')).toBeVisible();
  await expect(page.locator('[data-part-id="ws2812b-rgb"]')).toHaveCount(0);
  await expect(page.locator("#acaciaPlanPanel")).not.toContainText(/TensorFlow Lite|TFLM/i);

  expect(
    await page.locator("input, textarea").evaluateAll((fields) =>
      fields.some((field) =>
        /api[ _-]?key/i.test(
          `${field.id} ${field.getAttribute("name") || ""} ${field.getAttribute("placeholder") || ""}`,
        ),
      ),
    ),
  ).toBe(false);
  expect(calls.proposals).toEqual([
    { idea: "Collect motion examples and classify three hand gestures." },
  ]);
  expect(JSON.stringify(calls.proposals)).not.toMatch(/api[ _-]?key/i);
  expect(calls.openai).toEqual([]);
});

test("plain Pilot keeps its ordinary entry and never calls an Acacia endpoint", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop covers the non-program regression.");
  const calls = await installApiMocks(page);

  await page.goto("/pilot");
  await page.waitForLoadState("networkidle");

  await expect(page).toHaveTitle("Start with an idea or a photo · Makeable");
  await expect(page.getByRole("heading", { level: 1, name: /How would you like to start/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take or choose a photo" }).first()).toBeVisible();
  await expect(page.locator("#programBadge")).toBeHidden();
  await expect(page.locator("#acaciaKitIntro")).toBeHidden();
  await expect.poll(() =>
    page.evaluate(() => location.pathname + location.search + location.hash),
  ).toBe("/pilot#capture");
  expect(calls.acaciaPaths).toEqual([]);
  expect(calls.proposals).toEqual([]);
  expect(calls.accepts).toEqual([]);
});

test("the Acacia Plan has no narrow-screen overflow or serious accessibility violations", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile covers responsive Acacia acceptance.");
  await installApiMocks(page);
  await openAcacia(page);
  await requestIdea(page, "Help residents notice when the common room is too hot.");

  const viewport = page.viewportSize();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.viewportWidth).toBe(viewport.width);
  expect(dimensions.documentWidth).toBeLessThanOrEqual(viewport.width);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(viewport.width);

  const results = await new AxeBuilder({ page })
    .include("#acaciaPlanPanel")
    .analyze();
  const serious = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(serious).toEqual([]);
});
