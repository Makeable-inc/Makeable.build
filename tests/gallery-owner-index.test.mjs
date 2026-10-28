import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createMemoryBlobStore,
  indexAllGalleryOwners,
  listAccountGalleryBuilds,
  recordGalleryOwner,
  refundKnownUnusableBuildCredit,
} from "../lib/build-jobs.mjs";

const ABEL = "google-abel";
const MO = "google-mo";

function galleryRecord(id, ownerSub, overrides = {}) {
  return {
    id,
    createdAt: "2026-10-01T00:00:00.000Z",
    claimedAt: "2026-10-01T00:00:00.000Z",
    title: `Build ${id}`,
    summary: "A compact ESP32 build.",
    ownerSub,
    publishState: "public",
    parts: [],
    ...overrides,
  };
}

async function seededStore() {
  const store = createMemoryBlobStore();
  for (const record of [
    galleryRecord("build_abel_1", ABEL, { claimedAt: "2026-10-02T00:00:00.000Z" }),
    galleryRecord("build_abel_2", ABEL, { claimedAt: "2026-10-03T00:00:00.000Z" }),
    galleryRecord("build_abel_refunded", ABEL, { creditDisposition: { state: "refunded" } }),
    galleryRecord("build_mo_1", MO),
    galleryRecord("build_mo_2", MO),
  ]) {
    await store.setJSON(`gallery/${record.id}.json`, record);
  }
  return store;
}

// Counts reads of gallery records, the expensive part of My projects.
function countingGalleryReads(store) {
  const counter = { reads: 0 };
  const get = store.get.bind(store);
  store.get = async (key, options) => {
    if (String(key).startsWith("gallery/")) counter.reads += 1;
    return get(key, options);
  };
  return counter;
}

const ids = (builds) => builds.map((build) => build.id);

test("My projects lists only the user's builds, newest first, without refunded ones", async () => {
  const store = await seededStore();
  assert.deepEqual(ids(await listAccountGalleryBuilds(store, ABEL)), ["build_abel_2", "build_abel_1"]);
});

test("the first visit reads every build once; later visits read only the user's own builds", async () => {
  const store = await seededStore();
  const counter = countingGalleryReads(store);
  await listAccountGalleryBuilds(store, ABEL);
  assert.equal(counter.reads, 5);
  counter.reads = 0;
  assert.deepEqual(ids(await listAccountGalleryBuilds(store, ABEL)), ["build_abel_2", "build_abel_1"]);
  assert.equal(counter.reads, 3);
});

test("a build claimed after indexing shows up without reading everyone's builds", async () => {
  const store = await seededStore();
  await listAccountGalleryBuilds(store, ABEL);
  const fresh = galleryRecord("build_abel_new", ABEL, { claimedAt: "2026-10-09T00:00:00.000Z" });
  await store.setJSON(`gallery/${fresh.id}.json`, fresh);
  await recordGalleryOwner(store, ABEL, fresh.id);
  const counter = countingGalleryReads(store);
  assert.deepEqual(ids(await listAccountGalleryBuilds(store, ABEL)), ["build_abel_new", "build_abel_2", "build_abel_1"]);
  assert.equal(counter.reads, 4);
});

test("a user who was never indexed still sees builds that predate their first pointer", async () => {
  const store = await seededStore();
  const fresh = galleryRecord("build_abel_new", ABEL, { claimedAt: "2026-10-09T00:00:00.000Z" });
  await store.setJSON(`gallery/${fresh.id}.json`, fresh);
  await recordGalleryOwner(store, ABEL, fresh.id);
  assert.deepEqual(ids(await listAccountGalleryBuilds(store, ABEL)), ["build_abel_new", "build_abel_2", "build_abel_1"]);
});

test("a pointer to someone else's or a missing build is ignored", async () => {
  const store = await seededStore();
  await listAccountGalleryBuilds(store, ABEL);
  await recordGalleryOwner(store, ABEL, "build_mo_1");
  await recordGalleryOwner(store, ABEL, "build_deleted");
  assert.deepEqual(ids(await listAccountGalleryBuilds(store, ABEL)), ["build_abel_2", "build_abel_1"]);
});

test("the refund check on every build start reads only the user's builds once indexed", async () => {
  const store = await seededStore();
  await listAccountGalleryBuilds(store, ABEL);
  const counter = countingGalleryReads(store);
  await refundKnownUnusableBuildCredit(store, ABEL);
  assert.equal(counter.reads, 3);
});

test("the backfill indexes every owner once, so even a first visit reads only the user's builds", async () => {
  const store = await seededStore();
  assert.deepEqual(await indexAllGalleryOwners(store), { owners: 2, pointers: 5 });
  const counter = countingGalleryReads(store);
  assert.deepEqual(ids(await listAccountGalleryBuilds(store, MO)).sort(), ["build_mo_1", "build_mo_2"]);
  assert.equal(counter.reads, 2);
  counter.reads = 0;
  await listAccountGalleryBuilds(store, ABEL);
  assert.equal(counter.reads, 3);
  assert.deepEqual(await indexAllGalleryOwners(store), { owners: 2, pointers: 5 });
});

test("owner pointers name the build only and sit under a hash of the user id", async () => {
  const store = await seededStore();
  await listAccountGalleryBuilds(store, ABEL);
  const prefix = `owners/${createHash("sha256").update(ABEL).digest("hex")}/`;
  const keys = (await store.list({ prefix })).blobs.map((blob) => blob.key).sort();
  assert.ok(keys.includes(`${prefix}build_abel_1.json`));
  assert.ok(keys.every((key) => !key.includes(ABEL)));
  assert.deepEqual(await store.get(`${prefix}build_abel_1.json`, { type: "json" }), { buildId: "build_abel_1" });
});
