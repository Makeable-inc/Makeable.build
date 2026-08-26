import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the public landing bundle contains every referenced local asset", async () => {
  await import(`../scripts/build-production-static.mjs?landing-test=${Date.now()}`);
  const landingHtml = await readFile(path.join(root, "release-dist", "index.html"), "utf8");
  assert.match(landingHtml, /\/_next\/static\/chunks\//);

  const references = [
    "/makeable-logo.png",
    "/concepts/homepage-v2/ember-flagship-hero-v2.webp",
    "/concepts/homepage-v2/study-desk-companion-v2.webp",
    "/concepts/homepage-v2/plant-companion-v2.webp",
    "/concepts/homepage-v2/motion-light-v2.webp",
    "/avatars/maya-chen.svg",
    "/avatars/noor-ali.svg",
    "/avatars/leo-park.svg",
    "/assets/landing/gallery-v2/window-air.webp",
    "/assets/landing/gallery-v2/pet-water.webp",
    "/assets/landing/gallery-v2/quiet-chime.webp",
  ];

  for (const reference of references) {
    await access(path.join(root, "release-dist", reference));
  }
});

test("the landing bundle does not expose the pilot or builder source entrypoints", async () => {
  const landingScript = await readFile(path.join(root, "landing.js"), "utf8");
  assert.doesNotMatch(landingScript, /makeable\.pilot|\/build\/new|intent:\s*["']pilot/);
  await assert.rejects(access(path.join(root, "release-dist", "app.js")));
  await assert.rejects(access(path.join(root, "release-dist", "styles.css")));
});

test("production Google sign-in uses the SDK-rendered popup flow", async () => {
  const landingSource = await readFile(
    path.join(root, "apps", "landing", "app", "page.tsx"),
    "utf8",
  );
  assert.match(landingSource, /window\.google\.accounts\.id\.renderButton\(/);
  assert.match(landingSource, /ux_mode:\s*"popup"/);
  assert.match(landingSource, /fetch\(apiUrl\("\/api\/auth\/google"\)/);
  assert.match(landingSource, /generationAbortRef = useRef<AbortController/);
  assert.match(landingSource, /fetch\(apiUrl\("\/api\/build-jobs"\)/);
  assert.doesNotMatch(landingSource, /window\.google\.accounts\.id\.prompt\(/);
});
