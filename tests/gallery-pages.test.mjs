import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GALLERY_PAGE_SIZE, appendGalleryPage, galleryPageUrl, loadGalleryPage } from "../apps/landing/app/gallery-pages.ts";

function answer(status, body) {
  return () => Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
}

test("the homepage asks for one page of builds, then the next with the cursor", () => {
  assert.equal(GALLERY_PAGE_SIZE, 24);
  assert.equal(galleryPageUrl(""), "/api/builds?limit=24");
  assert.equal(galleryPageUrl("a+b/c="), "/api/builds?limit=24&cursor=a%2Bb%2Fc%3D");
});

test("a page returns its builds and the cursor for the next one", async () => {
  const page = await loadGalleryPage(answer(200, { builds: [{ id: "a" }], nextCursor: "next" }), "/api/builds?limit=24");
  assert.deepEqual(page, { ok: true, builds: [{ id: "a" }], nextCursor: "next" });
  const last = await loadGalleryPage(answer(200, { builds: [{ id: "b" }] }), "/api/builds?limit=24");
  assert.deepEqual(last, { ok: true, builds: [{ id: "b" }], nextCursor: null });
});

test("a failed, malformed or unreachable page is a failure, never an empty last page", async () => {
  assert.deepEqual(await loadGalleryPage(answer(500, {}), "u"), { ok: false });
  assert.deepEqual(await loadGalleryPage(answer(200, "<html>"), "u"), { ok: false });
  assert.deepEqual(await loadGalleryPage(answer(200, { builds: {} }), "u"), { ok: false });
  assert.deepEqual(await loadGalleryPage(() => Promise.reject(new TypeError("offline")), "u"), { ok: false });
});

test("a page that never answers fails after the time limit instead of waiting forever", async () => {
  const hang = (_url, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const started = Date.now();
  assert.deepEqual(await loadGalleryPage(hang, "u", 50), { ok: false });
  assert.ok(Date.now() - started < 2000);
});

test("a page request is abandoned when the caller cancels it", async () => {
  let aborted = false;
  const hang = (_url, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
  });
  const caller = new AbortController();
  const pending = loadGalleryPage(hang, "u", 10000, caller.signal);
  caller.abort();
  assert.deepEqual(await pending, { ok: false });
  assert.equal(aborted, true);
});

test("when the first page fails, the homepage says so and offers Try again instead of an empty gallery", async () => {
  const home = await readFile(new URL("../apps/landing/app/page.tsx", import.meta.url), "utf8");
  assert.match(home, /setGalleryLoadFailed\(!page\.ok\)/);
  assert.match(home, /\{galleryLoadFailed && \(/);
  assert.match(home, /Makeable could not load the community builds\./);
  // The message stays while retrying and the button says it is working.
  assert.match(home, /onClick=\{retryGallery\} disabled=\{galleryRetrying\}>\s*\{galleryRetrying \? "Loading\.\.\." : "Try again"\}/);
  assert.doesNotMatch(home, /setGalleryLoadFailed\(false\)/);
  assert.match(home, /return \(\) => \{\s*cancelled = true;\s*controller\.abort\(\);/);
});

test("/app offers Try again when the community list fails, and does not call it 'My builds' when signed out", async () => {
  const app = await readFile(new URL("../apps/landing/app/app/page.tsx", import.meta.url), "utf8");
  assert.match(app, /\{\(accountUnavailable \|\| publicFailed\) && <button/);
  assert.match(app, /user \? "My builds" : "Community builds"/);
});

test("a loaded page is added after what is shown, without repeating a build", () => {
  assert.deepEqual(
    appendGalleryPage([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]),
    [{ id: "a" }, { id: "b" }, { id: "c" }],
  );
});

test("the homepage loads the first page and the full gallery offers Load more", async () => {
  const home = await readFile(new URL("../apps/landing/app/page.tsx", import.meta.url), "utf8");
  assert.match(home, /loadGalleryPage<BuildProject>\(fetch, apiUrl\(galleryPageUrl\(""\)\),/);
  assert.doesNotMatch(home, /fetch\(apiUrl\("\/api\/builds"\)/);
  assert.match(home, /galleryPageUrl\(galleryCursor\)/);
  assert.match(home, /hasMore=\{Boolean\(galleryCursor\)\}/);
  assert.match(home, /\{hasMore && \(/);
  assert.match(home, /"Load more"/);
});
