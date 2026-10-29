import assert from "node:assert/strict";
import test from "node:test";

import { pageGalleryBuilds } from "../lib/build-jobs.mjs";

// Newest first, the order listPublicGalleryBuilds returns.
function builds(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `build_${String(count - index).padStart(3, "0")}`,
    claimedAt: new Date(Date.UTC(2026, 9, 1) + (count - index) * 60_000).toISOString(),
  }));
}

function walk(all, limit) {
  const seen = [];
  let cursor = "";
  for (let pages = 0; pages < 100; pages += 1) {
    const page = pageGalleryBuilds(all, { limit, cursor });
    seen.push(...page.builds.map((build) => build.id));
    if (!page.nextCursor) return seen;
    cursor = page.nextCursor;
  }
  throw new Error("paging never ended");
}

test("without a limit the whole list comes back, as before", () => {
  const all = builds(30);
  assert.deepEqual(pageGalleryBuilds(all, {}), { builds: all, nextCursor: null });
});

test("pages walk the whole list once, in order, then stop", () => {
  const all = builds(50);
  assert.deepEqual(walk(all, 24), all.map((build) => build.id));
  const first = pageGalleryBuilds(all, { limit: 24 });
  assert.equal(first.builds.length, 24);
  assert.ok(first.nextCursor);
  assert.equal(pageGalleryBuilds(all, { limit: 50 }).nextCursor, null);
});

test("a build added between pages does not repeat or skip one", () => {
  const all = builds(30);
  const first = pageGalleryBuilds(all, { limit: 10 });
  const newer = { id: "build_new", claimedAt: "2026-12-01T00:00:00.000Z" };
  const second = pageGalleryBuilds([newer, ...all], { limit: 10, cursor: first.nextCursor });
  assert.deepEqual(second.builds.map((build) => build.id), all.slice(10, 20).map((build) => build.id));
});

test("builds saved in the same second are told apart by id", () => {
  const at = "2026-10-01T00:00:00.000Z";
  const all = ["build_c", "build_b", "build_a"].map((id) => ({ id, claimedAt: at }));
  assert.deepEqual(walk(all, 1), ["build_c", "build_b", "build_a"]);
});

test("a build hidden between pages does not break the next page", () => {
  const all = builds(20);
  const first = pageGalleryBuilds(all, { limit: 5 });
  const withoutLastSeen = all.filter((build) => build.id !== first.builds.at(-1).id);
  const second = pageGalleryBuilds(withoutLastSeen, { limit: 5, cursor: first.nextCursor });
  assert.deepEqual(second.builds.map((build) => build.id), all.slice(5, 10).map((build) => build.id));
});

test("a bad limit or cursor is refused rather than guessed", () => {
  const all = builds(5);
  for (const limit of [0, -1, 101, 1.5, Number.NaN]) {
    assert.throws(() => pageGalleryBuilds(all, { limit }), /gallery_page_invalid/, `limit ${limit}`);
  }
  for (const cursor of ["nope", "e30", Buffer.from(JSON.stringify(["x"])).toString("base64url")]) {
    assert.throws(() => pageGalleryBuilds(all, { limit: 2, cursor }), /gallery_page_invalid/, `cursor ${cursor}`);
  }
});
