import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVE_STORES, contentTypeFor, migrateStore, planStore } from "../scripts/migrate-blobs.mjs";

const bytes = (text) => new TextEncoder().encode(text);

function fakeSource(records) {
  return {
    async list() {
      return Object.entries(records).map(([key, r]) => ({ key, etag: r.etag }));
    },
    async read(key) {
      return records[key];
    },
  };
}

function fakeTarget(initial = {}) {
  const objects = new Map(Object.entries(initial));
  return {
    objects,
    async list() {
      return [...objects].map(([key, o]) => ({ key, etag: o.metadata?.["netlify-etag"] || "" }));
    },
    async write(key, data, { contentType, metadata }) {
      objects.set(key, { data, contentType, metadata });
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

test("the live stores are the eight the app reads in production", () => {
  assert.deepEqual([...LIVE_STORES].sort(), [
    "builder-sessions",
    "community-builds",
    "makeable-build-images",
    "makeable-build-jobs",
    "makeable-build-quota-ledger",
    "makeable-social-analytics",
    "waitlist",
    "waitlist-sessions",
  ]);
});

test("plan splits keys into copy (new or changed), unchanged and extra", () => {
  const plan = planStore(
    [{ key: "a", etag: "1" }, { key: "b", etag: "2" }, { key: "c", etag: "3" }],
    [{ key: "b", etag: "2" }, { key: "c", etag: "old" }, { key: "test-only", etag: "" }],
  );
  assert.deepEqual(plan, { copy: ["a", "c"], unchanged: ["b"], extra: ["test-only"] });
});

test("content type: image metadata wins, JSON gets application/json, else octet-stream", () => {
  assert.equal(contentTypeFor(bytes("{}"), { contentType: "image/png" }), "image/png");
  assert.equal(contentTypeFor(bytes('{"a":1}'), {}), "application/json");
  assert.equal(contentTypeFor(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {}), "application/octet-stream");
});

test("apply copies bytes, content type, metadata and the Netlify etag", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x00, 0xff]);
  const source = fakeSource({
    "gallery/x.json": { bytes: bytes('{"id":"x"}'), etag: "e1", metadata: {} },
    "gallery-images/x": { bytes: png, etag: "e2", metadata: { contentType: "image/png" } },
  });
  const target = fakeTarget();
  const result = await migrateStore({ source, target, apply: true });
  assert.deepEqual(result, { copied: 2, unchanged: 0, extra: 0, deleted: 0 });
  assert.deepEqual([...target.objects.get("gallery-images/x").data], [...png]);
  assert.equal(target.objects.get("gallery-images/x").contentType, "image/png");
  assert.deepEqual(target.objects.get("gallery-images/x").metadata, { contentType: "image/png", "netlify-etag": "e2" });
  assert.equal(target.objects.get("gallery/x.json").contentType, "application/json");
});

test("a second run copies nothing; a changed record is copied again", async () => {
  const records = { a: { bytes: bytes("1"), etag: "e1", metadata: {} } };
  const target = fakeTarget();
  await migrateStore({ source: fakeSource(records), target, apply: true });
  assert.deepEqual(await migrateStore({ source: fakeSource(records), target, apply: true }), { copied: 0, unchanged: 1, extra: 0, deleted: 0 });
  records.a = { bytes: bytes("2"), etag: "e2", metadata: {} };
  assert.deepEqual(await migrateStore({ source: fakeSource(records), target, apply: true }), { copied: 1, unchanged: 0, extra: 0, deleted: 0 });
  assert.equal(new TextDecoder().decode(target.objects.get("a").data), "2");
});

test("dry run writes and deletes nothing", async () => {
  const target = fakeTarget({ stale: { data: bytes("x"), metadata: {} } });
  const result = await migrateStore({
    source: fakeSource({ a: { bytes: bytes("1"), etag: "e1", metadata: {} } }),
    target,
    apply: false,
    deleteExtra: true,
  });
  assert.deepEqual(result, { copied: 0, unchanged: 0, extra: 1, deleted: 0, toCopy: 1 });
  assert.deepEqual([...target.objects.keys()], ["stale"]);
});

test("delete-extra removes only keys the source no longer has", async () => {
  const target = fakeTarget({
    keep: { data: bytes("1"), metadata: { "netlify-etag": "e1" } },
    "smoke-test-record": { data: bytes("x"), metadata: {} },
  });
  const result = await migrateStore({
    source: fakeSource({ keep: { bytes: bytes("1"), etag: "e1", metadata: {} } }),
    target,
    apply: true,
    deleteExtra: true,
  });
  assert.deepEqual(result, { copied: 0, unchanged: 1, extra: 1, deleted: 1 });
  assert.deepEqual([...target.objects.keys()], ["keep"]);
});

test("without delete-extra, an apply never deletes anything on S3", async () => {
  const target = fakeTarget({ "only-on-s3": { data: bytes("x"), metadata: {} } });
  const result = await migrateStore({
    source: fakeSource({ a: { bytes: bytes("1"), etag: "e1", metadata: {} } }),
    target,
    apply: true,
  });
  assert.deepEqual(result, { copied: 1, unchanged: 0, extra: 1, deleted: 0 });
  assert.ok(target.objects.has("only-on-s3"));
});

test("progress output never contains a key or a value", async () => {
  const lines = [];
  await migrateStore({
    source: fakeSource({ "signup-secretemail": { bytes: bytes('{"email":"a@b.c"}'), etag: "e1", metadata: {} } }),
    target: fakeTarget(),
    apply: true,
    log: (line) => lines.push(line),
  });
  const output = lines.join("\n");
  assert.doesNotMatch(output, /secretemail|a@b\.c/);
});
