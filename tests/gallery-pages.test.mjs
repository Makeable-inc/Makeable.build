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

test("a loaded page is added after what is shown, without repeating a build", () => {
  assert.deepEqual(
    appendGalleryPage([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]),
    [{ id: "a" }, { id: "b" }, { id: "c" }],
  );
});

test("the homepage loads the first page and the full gallery offers Load more", async () => {
  const home = await readFile(new URL("../apps/landing/app/page.tsx", import.meta.url), "utf8");
  assert.match(home, /loadGalleryPage<BuildProject>\(fetch, apiUrl\(galleryPageUrl\(""\)\)\)/);
  assert.doesNotMatch(home, /fetch\(apiUrl\("\/api\/builds"\)/);
  assert.match(home, /galleryPageUrl\(galleryCursor\)/);
  assert.match(home, /hasMore=\{Boolean\(galleryCursor\)\}/);
  assert.match(home, /\{hasMore && \(/);
  assert.match(home, /"Load more"/);
});
