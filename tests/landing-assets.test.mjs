import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

test("the deployed homepage is the Moment in Motion experience", async () => {
  const html = await readFile(path.join(dist, "index.html"), "utf8");
  assert.match(html, /<title>Makeable — Feed Ember Tokens\.<\/title>/);
  assert.match(html, /_next\/static/);
  await access(path.join(dist, "build-catalogue-page.png"));
  await access(path.join(dist, "makeable-logo.png"));
});

test("both optimized animation sequences are included in the deployment", async () => {
  const desktopFrames = await readdir(path.join(dist, "frames-v2"));
  const mobileFrames = await readdir(path.join(dist, "frames-mobile"));
  assert.equal(desktopFrames.filter((name) => name.endsWith(".webp")).length, 301);
  assert.equal(mobileFrames.filter((name) => name.endsWith(".webp")).length, 300);
  await access(path.join(dist, "frames-v2", "frame_301.webp"));
  await access(path.join(dist, "frames-mobile", "frame_300.webp"));
});

test("all existing public pages remain in the combined deployment", async () => {
  for (const routeFile of [
    "privacy/index.html",
    "terms/index.html",
    "ember/index.html",
    "dashboard/index.html",
    "pilot-app.html",
  ]) {
    await access(path.join(dist, routeFile));
  }
});
