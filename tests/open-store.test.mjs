import assert from "node:assert/strict";
import { test } from "node:test";
import { openStore } from "../lib/storage/index.mjs";
import { createFakeS3Client } from "./helpers/fake-s3-client.mjs";

test("memory: same name shares data, different names do not", async () => {
  const env = { MAKEABLE_STORAGE_BACKEND: "memory" };
  await openStore({ name: "open-store-a" }, { env }).setJSON("k", { v: 1 });
  assert.deepEqual(await openStore({ name: "open-store-a" }, { env }).get("k", { type: "json" }), { v: 1 });
  assert.equal(await openStore({ name: "open-store-b" }, { env }).get("k", { type: "json" }), null);
});

test("s3: \"waitlist\" and \"waitlist-preview\" do not see each other's keys", async () => {
  const env = { MAKEABLE_STORAGE_BACKEND: "s3", MAKEABLE_STORAGE_BUCKET: "test-bucket" };
  const s3Client = createFakeS3Client();
  await openStore({ name: "waitlist" }, { env, s3Client }).setJSON("signup-1", { v: 1 });
  const preview = openStore({ name: "waitlist-preview" }, { env, s3Client });
  assert.equal(await preview.get("signup-1", { type: "json" }), null);
  assert.deepEqual((await preview.list()).blobs, []);
});

test("s3 without MAKEABLE_STORAGE_BUCKET throws", () => {
  assert.throws(
    () => openStore({ name: "jobs" }, { env: { MAKEABLE_STORAGE_BACKEND: "s3" }, s3Client: createFakeS3Client() }),
    /MAKEABLE_STORAGE_BUCKET/,
  );
});

test("unknown backend throws instead of falling back to Netlify", () => {
  assert.throws(() => openStore({ name: "jobs" }, { env: { MAKEABLE_STORAGE_BACKEND: "s4" } }), /s4/);
});

test("default backend is Netlify Blobs", () => {
  const calls = [];
  const blobsStore = { get() {} };
  const store = openStore(
    { name: "jobs", consistency: "strong" },
    { env: {}, getNetlifyStore: (options) => (calls.push(options), blobsStore) },
  );
  assert.equal(store, blobsStore);
  assert.deepEqual(calls, [{ name: "jobs", consistency: "strong" }]);
});
