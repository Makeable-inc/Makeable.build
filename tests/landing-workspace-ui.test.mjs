import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homePath = new URL("../apps/landing/app/page.tsx", import.meta.url);
const appPath = new URL("../apps/landing/app/app/page.tsx", import.meta.url);
const workspacePath = new URL("../apps/landing/app/workspace-ui.tsx", import.meta.url);
const workspaceCssPath = new URL("../apps/landing/app/workspace.css", import.meta.url);

test("generation wait uses real checkpoints without the cat or quota noise", async () => {
  const [home, workspace, workspaceCss] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(workspacePath, "utf8"),
    readFile(workspaceCssPath, "utf8"),
  ]);

  assert.doesNotMatch(home, /Maker Cat is|mk-generation-sprite/);
  assert.match(workspace, /Build progress/);
  assert.match(workspace, /Plan/);
  assert.match(workspace, /Fit parts/);
  assert.match(workspace, /Render/);
  assert.match(workspace, /Finish/);
  assert.match(workspace, /daily limit\|free build\|quota\|browser or network/);
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

test("a claimed build opens the polished detail sheet instead of the legacy workspace route", async () => {
  const home = await readFile(homePath, "utf8");

  assert.match(home, /setDetailBuild\(build\)/);
  assert.doesNotMatch(home, /router\.push\(`\/app\?build=/);
});

test("desktop parts span the workspace and mobile hero keeps media separate from copy", async () => {
  const [home, app, workspaceCss] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(appPath, "utf8"),
    readFile(workspaceCssPath, "utf8"),
  ]);

  assert.doesNotMatch(home, /mk-menu-button/);
  assert.match(home, /className="mk-mobile-hero-media"/);
  assert.match(home, /<\/section>\s*<section className="mk-parts mk-workspace-parts"/);
  assert.match(app, /<\/section>\s*<section className="mk-parts mk-workspace-parts"/);
  assert.match(workspaceCss, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
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
