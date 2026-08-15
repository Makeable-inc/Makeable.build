import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the production landing and pilot stay packaged as self-contained experiences", async () => {
  await import(`../scripts/build-static.mjs?pilot-test=${Date.now()}`);

  const pilotHtml = await readFile(path.join(root, "dist", "pilot-app.html"), "utf8");
  assert.match(pilotHtml, /<base href="\/pilot\/" \/>/);
  assert.match(pilotHtml, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(pilotHtml, /<script src="\/config\.local\.js"><\/script>/);
  assert.doesNotMatch(pilotHtml, /src="\.\/config\.local\.js"/);

  for (const relativePath of [
    "pilot/app.js",
    "pilot/styles.css",
    "pilot/lib/board-profiles.mjs",
    "pilot/lib/plain-language.mjs",
    "pilot/lib/wiring-annotations.mjs",
    "pilot/images/makeable/icon-chat.svg",
    "pilot/images/makeable/upload-parts-clean.svg",
    "pilot/images/makeable/photo-tip-lighting.jpg",
    "pilot/images/makeable/photo-tip-spacing.jpg",
    "pilot/images/makeable/photo-tip-angle.jpg",
  ]) {
    await access(path.join(root, "dist", relativePath));
  }

  const landingHtml = await readFile(path.join(root, "dist", "index.html"), "utf8");
  assert.match(landingHtml, /<title>Makeable<\/title>/);
  assert.match(landingHtml, /Scroll to explore Ember/);
  assert.match(landingHtml, /Show me other builds\./);
  assert.match(landingHtml, /Seen on real desks\./i);
  assert.match(landingHtml, /Make your.*own build\./is);
  assert.match(landingHtml, /Anything is makeable\./i);
  assert.doesNotMatch(landingHtml, /Browse more builds/);
  assert.match(landingHtml, /_next\/static/);
  for (const relativePath of [
    "styles/legal.css",
    "assets/fonts/fredoka/fredoka.woff2",
    "assets/icons/google-g.svg",
    "assets/landing/desk-parts.jpeg",
    "frames-v2/frame_301.webp",
    "frames-mobile/frame_300.webp",
    "robots.txt",
    "sitemap.xml",
    "privacy/index.html",
    "terms/index.html",
    "dashboard/index.html",
    "dashboard/app.js",
    "dashboard/styles.css",
  ]) {
    await access(path.join(root, "dist", relativePath));
  }

  const privacyHtml = await readFile(path.join(root, "dist", "privacy", "index.html"), "utf8");
  const termsHtml = await readFile(path.join(root, "dist", "terms", "index.html"), "utf8");
  assert.match(privacyHtml, /Google sign-in supplies your name, email address, and email verification/);
  assert.match(privacyHtml, /stable account identifier/);
  assert.match(privacyHtml, /does not store either in new waitlist records/);
  assert.match(privacyHtml, /random, HttpOnly browser/);
  assert.match(privacyHtml, /not a Google credential/);
  assert.match(privacyHtml, /Netlify Blobs/);
  assert.match(privacyHtml, /mohammedkhambhati2020@gmail\.com/);
  assert.match(termsHtml, /Early access, not a finished product/);
  assert.match(termsHtml, /acceptable-use rules/);

  await assert.rejects(access(path.join(root, "dist", "app.js")));
  await assert.rejects(access(path.join(root, "dist", "styles.css")));
});

test("the parts scan teaches photo setup and starts recognition automatically", async () => {
  const pilotHtml = await readFile(path.join(root, "pilot", "index.html"), "utf8");
  const pilotScript = await readFile(path.join(root, "pilot", "app.js"), "utf8");
  const pilotStyles = await readFile(path.join(root, "pilot", "styles.css"), "utf8");

  assert.match(pilotHtml, /id="projectBriefText"/);
  assert.match(pilotHtml, /<div class="project-brief"[^>]*><span>Building<\/span>/);
  assert.doesNotMatch(pilotHtml, /<section class="project-brief"/);
  assert.match(pilotHtml, /data-scan-step="1"/);
  assert.match(pilotHtml, /data-scan-step="2"/);
  assert.match(pilotHtml, /data-scan-step="3"/);
  assert.match(pilotHtml, /id="photoPrepDialog"/);
  assert.match(pilotHtml, /photo-tip-lighting\.jpg/);
  assert.match(pilotHtml, /upload-parts-clean\.svg/);
  assert.match(pilotHtml, /This starts automatically/);
  assert.doesNotMatch(pilotHtml, /id="analyzeButton"|Name my parts/);

  assert.match(pilotScript, /const PHOTO_PREP_STEPS = \[/);
  assert.equal((pilotScript.match(/photo-tip-(?:lighting|spacing|angle)\.jpg/g) || []).length, 3);
  assert.match(pilotScript, /photoPrepDialog\.showModal\(\)/);
  assert.match(pilotScript, /Looks good — choose photo/);
  assert.match(pilotScript, /if \(!state\.photoPrepComplete\)/);
  assert.match(pilotScript, /displayImg\.onload = \(\) => \{[\s\S]*?void analyzeHardware\(\);/);
  assert.match(pilotScript, /function setScanProcessStep\(activeStep\)/);
  assert.match(pilotScript, /item-row item-row--tone-\$\{index % 4\}/);
  assert.match(pilotScript, /row\.dataset\.partNumber = String\(index \+ 1\)/);
  assert.match(pilotScript, /partsCountLabel\.classList\.toggle\("has-parts", plan\.parts\.length > 0\)/);

  assert.match(pilotStyles, /\.project-brief/);
  assert.match(pilotStyles, /\.scan-process/);
  assert.match(pilotStyles, /\.scan-process strong[^}]*font-size: 1\.1rem/);
  assert.match(pilotStyles, /\.scan-process small[^}]*font-size: \.9rem/);
  assert.match(pilotStyles, /\.item-row--tone-0/);
  assert.match(pilotStyles, /\.item-row--tone-3/);
  assert.match(pilotStyles, /\.recognized-heading > strong\.has-parts/);
  assert.match(pilotStyles, /\.photo-prep-dialog::backdrop/);
  assert.match(pilotStyles, /body:not\(\.has-parts-photo\) \.scan-clear-button/);
});

test("the Describe stage keeps inspiration in the same visual flow as the idea editor", async () => {
  const pilotHtml = await readFile(path.join(root, "pilot", "index.html"), "utf8");
  const pilotStyles = await readFile(path.join(root, "pilot", "styles.css"), "utf8");

  assert.match(pilotHtml, /<div class="idea-paper[\s\S]*?<section class="idea-suggestions"/);
  assert.match(pilotHtml, />Messy ideas are welcome\.</);
  assert.match(pilotHtml, />Serve food on a schedule</);
  assert.match(pilotHtml, />Cool the room when it is warm</);
  assert.match(pilotHtml, />Water a plant when it is dry</);
  assert.match(pilotStyles, /\.idea-suggestions\s*\{[\s\S]*?grid-column: 1 \/ -1/);
  assert.match(pilotStyles, /\.idea-prompt-grid\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(pilotHtml, /class="messy-note"/);
});

test("Netlify serves the landing at root and routes the private product surfaces", async () => {
  const config = await readFile(path.join(root, "netlify.toml"), "utf8");
  assert.match(
    config,
    /from = "\/pilot"[\s\S]*?to = "\/pilot-app\.html"[\s\S]*?status = 200[\s\S]*?force = true/,
  );
  assert.match(
    config,
    /for = "\/dashboard\/\*"[\s\S]*?Cache-Control = "no-store"[\s\S]*?X-Robots-Tag = "noindex, nofollow, noarchive"/,
  );
  assert.doesNotMatch(config, /from = "\/"/);
});

test("the pilot guides users from flashing into a camera-free test and behavior update loop", async () => {
  const pilotHtml = await readFile(path.join(root, "pilot", "index.html"), "utf8");
  const pilotScript = await readFile(path.join(root, "pilot", "app.js"), "utf8");
  const pilotStyles = await readFile(path.join(root, "pilot", "styles.css"), "utf8");

  assert.match(pilotHtml, /id="flashSuccessTransition"/);
  assert.match(pilotHtml, /id="flashCountdownNumber">3</);
  assert.match(pilotHtml, /id="testHardwareNowButton"[^>]*>Let’s test it</);
  assert.match(pilotHtml, /id="behaviorSummary"/);
  assert.match(pilotHtml, /id="codeFunctionList"/);
  assert.match(pilotHtml, />What the board is doing</);
  assert.match(pilotHtml, />In plain English</);
  assert.match(pilotHtml, /class="flash-load-layout"/);
  assert.match(pilotHtml, /class="flash-action-panel"/);
  assert.match(pilotHtml, /id="openBehaviorTuneButton"/);
  assert.match(pilotHtml, /id="behaviorTuneDialog"/);
  assert.match(pilotHtml, /id="behaviorChangeForm"/);
  assert.match(pilotHtml, /id="verifyPublishButton"/);
  assert.match(pilotHtml, /Try something else with this wiring/);
  assert.match(pilotHtml, /<dialog class="behavior-tune-dialog"[\s\S]*?<form class="behavior-change-form"/);
  assert.match(pilotHtml, /class="verify-primary-grid"/);
  assert.match(pilotHtml, /class="listener-toolbar"/);
  assert.match(pilotHtml, /class="command-card"/);
  assert.match(pilotHtml, />Start listening</);
  assert.match(pilotHtml, />Stop listening</);
  assert.match(pilotHtml, />Send message</);
  assert.match(pilotHtml, />Review messages</);
  assert.match(pilotHtml, /Update code &amp; reload/);
  assert.doesNotMatch(pilotHtml, /class="verify-command-grid/);
  assert.doesNotMatch(pilotHtml, /id="cameraPreview"|id="startCameraButton"|id="captureEvidenceButton"/);

  assert.match(pilotScript, /function startFlashSuccessTransition\(\)/);
  assert.match(pilotScript, /window\.setInterval[\s\S]*goToTestStage\(\)/);
  assert.match(pilotScript, /async function applyBehaviorChange\(event\)/);
  assert.match(pilotScript, /function openBehaviorTuneDialog\(\)/);
  assert.match(pilotScript, /function closeBehaviorTuneDialog\(\)/);
  assert.match(pilotScript, /verifyPublishButton\?\.addEventListener\("click", \(\) => setActiveWorkflowStage\(4\)\)/);
  assert.match(pilotScript, /async function regenerateFirmwareForBehaviorChange\(change\)/);
  assert.match(pilotScript, /connectSerial\(\{ automatic: true \}\)/);
  assert.match(pilotScript, /explainProjectForChild\(explanationProject\)/);
  assert.match(pilotScript, /name: "When it turns on"/);
  assert.match(pilotScript, /name: "While it is running"/);
  assert.match(pilotScript, /name: "What the messages mean"/);
  assert.doesNotMatch(pilotScript, /function startCamera|function captureEvidence|function verifyBehavior|facingMode: "environment"/);

  assert.match(pilotStyles, /\.terminal\s*\{[\s\S]*?height: 248px/);
  assert.match(pilotStyles, /\.test-action/);
  assert.match(pilotStyles, /\.terminal-shell/);
  assert.match(pilotStyles, /\.command-composer/);
  assert.match(pilotStyles, /\.behavior-change-form/);
  assert.match(pilotStyles, /\.flash-stage-grid--automatic[\s\S]*?width: min\(1240px, 100%\)/);
  assert.match(pilotStyles, /\.flash-load-layout/);
  assert.match(pilotStyles, /body\[data-stage="4"\] \.stage-controls/);
  assert.match(pilotStyles, /\.verify-completion-bar/);
  assert.doesNotMatch(pilotStyles, /\.camera-frame|#cameraPreview|\.camera-placeholder/);
});
