import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the current production app stays packaged as a self-contained pilot", async () => {
  await import(`../scripts/build-production-static.mjs?pilot-test=${Date.now()}`);

  const releaseRoot = path.join(root, "release-dist");
  const pilotHtml = await readFile(path.join(releaseRoot, "pilot-app.html"), "utf8");
  assert.match(pilotHtml, /<base href="\/pilot\/" \/>/);
  assert.match(pilotHtml, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(pilotHtml, /<script src="\/config\.local\.js"><\/script>/);
  assert.doesNotMatch(pilotHtml, /src="\.\/config\.local\.js"/);

  for (const relativePath of [
    "pilot/app.js",
    "pilot/styles.css",
    "pilot/lib/board-profiles.mjs",
    "pilot/lib/beginner-plan.mjs",
    "pilot/images/makeable/icon-chat.svg",
  ]) {
    await access(path.join(releaseRoot, relativePath));
  }

  const landingHtml = await readFile(path.join(releaseRoot, "index.html"), "utf8");
  assert.match(landingHtml, /Feed Ember Tokens\./);
  assert.match(landingHtml, /Builds to get you started/);
  assert.match(landingHtml, /Create your own build\./);
  assert.match(landingHtml, /\/_next\/static\/chunks\/app\/page-/);
  for (const relativePath of [
    "_next",
    "styles/legal.css",
    "assets/fonts/fredoka/fredoka.woff2",
    "concepts/homepage-v2/ember-flagship-hero-v2.webp",
    "robots.txt",
    "sitemap.xml",
    "privacy/index.html",
    "terms/index.html",
  ]) {
    await access(path.join(releaseRoot, relativePath));
  }

  const privacyHtml = await readFile(path.join(releaseRoot, "privacy", "index.html"), "utf8");
  const termsHtml = await readFile(path.join(releaseRoot, "terms", "index.html"), "utf8");
  assert.match(privacyHtml, /Google sign-in supplies your name, email address, and email verification/);
  assert.match(privacyHtml, /stable account identifier/);
  assert.match(privacyHtml, /not your Google account identifier/);
  assert.match(privacyHtml, /random, HttpOnly browser session/);
  assert.match(privacyHtml, /PostHog receives event details, not your email address, name, Google account/);
  assert.match(privacyHtml, /one-way pseudonymous Makeable account identifier/);
  assert.match(privacyHtml, /not a\s+Google credential/);
  assert.match(privacyHtml, /Netlify Blobs/);
  assert.match(privacyHtml, /mohammedkhambhati2020@gmail\.com/);
  assert.match(termsHtml, /Early access, not a finished product/);
  assert.match(termsHtml, /acceptable-use rules/);
  assert.match(landingHtml, /href="\/terms\/"/);
  const landingSource = await readFile(
    path.join(root, "apps", "landing", "app", "page.tsx"),
    "utf8",
  );
  assert.match(landingSource, /href="\/privacy\/"/);

  await assert.rejects(access(path.join(releaseRoot, "landing.js")));
  await assert.rejects(access(path.join(releaseRoot, "app.js")));
});

test("the pilot exposes both beginner entry paths and the gated five-stage workflow", async () => {
  const pilotHtml = await readFile(path.join(root, "pilot", "index.html"), "utf8");
  const pilotApp = await readFile(path.join(root, "pilot", "app.js"), "utf8");
  assert.match(pilotHtml, /How would you like to <span>start\?<\/span>/);
  assert.match(pilotHtml, /id="startPhotoFirstButton"/);
  assert.match(pilotHtml, /<strong>Check parts<\/strong>/);
  assert.match(pilotHtml, /No camera permission\. No proof photo\./);
  assert.match(pilotHtml, /id="includeFinishedBuildPhoto"[^>]*disabled/);
  assert.match(pilotHtml, /id="includeCreatorPhoto"[^>]*disabled/);
  assert.match(pilotApp, /validateBeginnerPlan/);
  assert.match(pilotApp, /automaticTestStatus === "pass"/);
  assert.match(pilotApp, /const mediaPath = kind === "finishedBuild" \? "images\/finished-build\.svg"/);
  assert.match(pilotApp, /apiJson\("\/api\/github\/publish-project"/);
  assert.match(pilotApp, /selectedMedia\.map\(\(\{ path, content \}\) => \(\{ path, content \}\)\)/);
  assert.match(pilotApp, /githubAtomicPublishSupported === true/);
  assert.doesNotMatch(pilotApp, /contentBase64/);
  assert.doesNotMatch(pilotApp, /async function startCamera/);
});

test("Netlify serves the landing at root and rewrites only the pilot entrypoint", async () => {
  const config = await readFile(path.join(root, "netlify.toml"), "utf8");
  assert.match(
    config,
    /from = "\/pilot"[\s\S]*?to = "\/pilot-app\.html"[\s\S]*?status = 200[\s\S]*?force = true/,
  );
  assert.doesNotMatch(config, /from = "\/"/);
});
