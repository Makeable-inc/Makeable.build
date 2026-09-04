import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homePath = new URL("../apps/landing/app/page.tsx", import.meta.url);
const appPath = new URL("../apps/landing/app/app/page.tsx", import.meta.url);
const workspacePath = new URL("../apps/landing/app/workspace-ui.tsx", import.meta.url);
const workspaceCssPath = new URL("../apps/landing/app/workspace.css", import.meta.url);
const premiumWorkspaceCssPath = new URL("../apps/landing/app/premium-workspace.css", import.meta.url);
const overviewPath = new URL("../apps/landing/app/project-overview.tsx", import.meta.url);
const wiringDataPath = new URL("../apps/landing/app/project-wiring-data.mjs", import.meta.url);
const wiringGuidePath = new URL("../apps/landing/app/project-wiring-guide.tsx", import.meta.url);

test("generation wait explains durable staged progress without quota noise", async () => {
  const [home, workspace, workspaceCss] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(workspacePath, "utf8"),
    readFile(workspaceCssPath, "utf8"),
  ]);

  assert.doesNotMatch(home, /Maker Cat is|mk-generation-sprite/);
  assert.match(workspace, /mk-generation-editorial/);
  assert.match(workspace, /You can leave this tab/);
  assert.match(workspace, /Build generation progress/);
  assert.match(workspace, /mk-generation-original.*\{prompt\}/);
  assert.match(workspace, /We’ll keep working/);
  assert.match(workspace, /Plan your build/);
  assert.match(workspace, /Choose parts/);
  assert.match(workspace, /Prepare assembly/);
  assert.match(workspace, /Finish up/);
  assert.doesNotMatch(workspace, /daily limit\|free build\|quota\|browser or network/);
});

test("workspace uses SVG arrows and renders a resilient Google avatar", async () => {
  const [home, app, workspace] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(appPath, "utf8"),
    readFile(workspacePath, "utf8"),
  ]);

  assert.doesNotMatch(home, /aria-hidden="true">&gt;<\/span>/);
  assert.doesNotMatch(app, /aria-hidden="true">&lt;<\/span>/);
  assert.match(workspace, /<svg/);
  assert.match(workspace, /user\?\.picture/);
  assert.match(workspace, /onError=/);
});

test("a claimed build opens the persistent project workspace with the polished overview", async () => {
  const [home, app, workspaceCss] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(appPath, "utf8"),
    readFile(workspaceCssPath, "utf8"),
  ]);

  assert.match(home, /window\.location\.assign\(`\/app\?build=/);
  assert.match(home, /<ProjectOverview build=\{build\}/);
  assert.match(app, /<ProjectOverview build=\{build\}/);
  assert.match(workspaceCss, /\.mk-project-overview/);
});

test("project workspace waits until hydration to read a shared project", async () => {
  const app = await readFile(appPath, "utf8");

  assert.match(app, /const \[sharedProject, setSharedProject\] = useState<BuildProject \| null>\(null\);/);
  assert.match(app, /useEffect\(\(\) => \{[\s\S]*?setSharedProject\(sharedProjectFromSession\(\)\);[\s\S]*?restoreBuildFromUrl\(\);[\s\S]*?\}, \[\]\);/);
  assert.doesNotMatch(app, /useState<BuildProject \| null>\(sharedProjectFromSession\)/);
});

test("project workspace keeps the solid overview and mobile hero keeps media separate from copy", async () => {
  const [home, app, workspaceCss] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(appPath, "utf8"),
    readFile(workspaceCssPath, "utf8"),
  ]);

  assert.doesNotMatch(home, /mk-menu-button/);
  assert.match(home, /className="mk-mobile-hero-media"/);
  assert.match(home, /<ProjectOverview build=\{build\}/);
  assert.match(app, /<ProjectOverview build=\{build\}/);
  assert.match(workspaceCss, /grid-template-columns: minmax\(19rem, 0\.78fr\) minmax\(34rem, 1\.22fr\)/);
  assert.match(workspaceCss, /\.mk-mobile-hero-media \{[\s\S]*?aspect-ratio: 16 \/ 10/);
});

test("folder skeleton mirrors render, summary, and part rows", async () => {
  const workspace = await readFile(workspacePath, "utf8");
  assert.match(workspace, /mk-skeleton-render/);
  assert.match(workspace, /mk-skeleton-brief/);
  assert.match(workspace, /SkeletonPartRows/);
});

test("community posts show creator handles and resilient profile pictures", async () => {
  const [home, workspaceCss] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(workspaceCssPath, "utf8"),
  ]);

  assert.match(home, /makerHandle\?: string/);
  assert.match(home, /makerPicture\?: string/);
  assert.match(home, /<CreatorBadge build=\{build\}/);
  assert.match(home, /@mchen\.workshop/);
  assert.match(home, /@noor\.al/);
  assert.match(home, /@parkbenchlab/);
  assert.match(home, /withCreatorSnapshot/);
  assert.match(workspaceCss, /mk-community-creator-card/);
  assert.match(home, /onError=/);
  assert.match(workspaceCss, /font-family: "Lexend"/);
  assert.match(home, /See what others made/);
  assert.match(home, /Full gallery/);
  assert.match(home, /Compare retailer prices/);
  assert.match(home, /\/api\/part-prices/);
  assert.match(home, /Amazon/);
  assert.match(home, /AliExpress/);
});

test("the generated project journey is overview with parts, wiring, then locked code", async () => {
  const [home, app, workspace, premiumWorkspaceCss, overview, wiringData, wiringGuide] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(appPath, "utf8"),
    readFile(workspacePath, "utf8"),
    readFile(premiumWorkspaceCssPath, "utf8"),
    readFile(overviewPath, "utf8"),
    readFile(wiringDataPath, "utf8"),
    readFile(wiringGuidePath, "utf8"),
  ]);

  for (const source of [home, app]) {
    assert.match(source, /<WorkspaceTopBar/);
    assert.match(source, /<WorkspaceContextBar/);
    assert.match(source, /<LockedCodePanel/);
    assert.doesNotMatch(source, /<aside className="mk-project-sidebar"/);
  }

  assert.match(workspace, /export type ProjectSurface = "overview" \| "wiring" \| "code"/);
  assert.match(workspace, /export function ProjectNavigation/);
  assert.match(workspace, /onSelect\("overview"\)/);
  assert.match(workspace, /onSelect\("wiring"\)/);
  assert.match(workspace, /<WorkspaceIcon kind="code" \/> Code/);
  assert.doesNotMatch(workspace.match(/export function ProjectNavigation[\s\S]*?\n\}/)?.[0] || "", /parts|enclosure/i);
  assert.match(overview, /<h2 id="project-parts-title">Parts<\/h2>/);
  assert.match(overview, /priceLabel/);
  assert.doesNotMatch(overview, /base \* 0\.62|retailerSearchUrl/);
  assert.match(wiringData, /projectWiringReady/);
  assert.match(wiringData, /guideSteps\.length > 0/);
  assert.match(wiringGuide, /Saved guide · No credit used/);
  assert.match(wiringGuide, /mk-wiring-pane-toggle/);
  assert.match(wiringGuide, /data-mobile-pane/);
  assert.match(premiumWorkspaceCss, /grid-template-rows: 64px 76px minmax\(0, 1fr\)/);
  assert.match(premiumWorkspaceCss, /height: 100svh/);
  assert.match(premiumWorkspaceCss, /\.mk-workspace-main[\s\S]*?overflow: hidden/);
  assert.match(premiumWorkspaceCss, /\.mk-wiring-step-controls[\s\S]*?justify-self: end/);
  assert.match(workspace, /export function LockedCodePanel/);
  assert.match(workspace, /Coming soon/);
  assert.match(workspace, /Firmware generation is next/);
  assert.match(workspace, /Your project is saved. No credit is used here/);
  assert.match(premiumWorkspaceCss, /\.mk-code-locked/);
  assert.match(premiumWorkspaceCss, /\.mk-code-editor-ghost/);
});

test("the localhost wiring fixture is a usable production-contract artifact", async () => {
  const { localWiringBuildFixture } = await import("./fixtures/local-wiring-build.mjs");
  assert.equal(localWiringBuildFixture.artifactStates.wiring.state, "ready");
  assert.ok(localWiringBuildFixture.artifacts.assembly.guideSteps.length > 0);
  assert.ok(localWiringBuildFixture.artifacts.assembly.wires.length > 0);
  assert.ok(localWiringBuildFixture.artifacts.assembly.parts.length > 0);
  assert.ok(localWiringBuildFixture.artifacts.assembly.guideSteps.every((step) => Array.isArray(step.activeWires)));
});

test("safe recovery preserves identity and exposes every supported exit", async () => {
  const [app, workspace] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(workspacePath, "utf8"),
  ]);

  assert.match(workspace, /Build ID/);
  assert.match(workspace, /Your idea/);
  assert.match(workspace, /No completed replacement was saved/);
  assert.match(workspace, /Build details/);
  assert.match(workspace, /Edit my idea/);
  assert.match(workspace, /My projects/);
  assert.match(app, /retryLabel="Try again"/);
  assert.match(app, /onEdit=\{\(\) => router\.push\("\/#make"\)\}/);
  assert.match(app, /Makeable did not substitute a different build/);
});
