import assert from "node:assert/strict";
import { test } from "node:test";

// The subset of the Netlify Blobs store API the app relies on. Every storage
// backend must pass this suite so lib/ can use any of them unchanged.
export function runStoreContract(label, makeStore) {
  test(`${label}: missing key returns null`, async () => {
    const store = await makeStore();
    assert.equal(await store.get("nope", { type: "json" }), null);
    assert.equal(await store.get("nope", { type: "arrayBuffer" }), null);
    assert.equal(await store.get("nope"), null);
  });

  test(`${label}: json round-trips through set and setJSON`, async () => {
    const store = await makeStore();
    const value = { idea: "温度计 🌡️", n: 1 };
    await store.set("a", new Blob([JSON.stringify(value)], { type: "application/json" }));
    await store.setJSON("b", value);
    assert.deepEqual(await store.get("a", { type: "json", consistency: "strong" }), value);
    assert.deepEqual(await store.get("b", { type: "json" }), value);
    assert.equal(await store.get("b"), JSON.stringify(value));
  });

  test(`${label}: binary round-trips byte for byte`, async () => {
    const store = await makeStore();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0a]);
    await store.set("img", new Blob([bytes], { type: "image/png" }), {
      metadata: { contentType: "image/png" },
    });
    const read = await store.get("img", { type: "arrayBuffer" });
    assert.deepEqual(new Uint8Array(read), bytes);
    const blob = await store.get("img", { type: "blob" });
    assert.equal(blob.type, "image/png");
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  });

  test(`${label}: onlyIfNew keeps the first value`, async () => {
    const store = await makeStore();
    assert.deepEqual(await store.setJSON("k", { v: 1 }, { onlyIfNew: true }), { modified: true });
    assert.deepEqual(await store.setJSON("k", { v: 2 }, { onlyIfNew: true }), { modified: false });
    assert.deepEqual(await store.get("k", { type: "json" }), { v: 1 });
  });

  test(`${label}: delete removes, deleting a missing key is fine`, async () => {
    const store = await makeStore();
    await store.setJSON("k", { v: 1 });
    await store.delete("k");
    assert.equal(await store.get("k", { type: "json" }), null);
    await store.delete("never-existed");
  });

  test(`${label}: list returns only prefixed keys, sorted`, async () => {
    const store = await makeStore();
    for (const key of ["jobs/b", "jobs/a", "quota/a", "jobsx"]) await store.setJSON(key, {});
    const page = await store.list({ prefix: "jobs/" });
    assert.deepEqual(page.blobs.map((blob) => blob.key), ["jobs/a", "jobs/b"]);
    assert.deepEqual(page.directories, []);
  });

  test(`${label}: list returns every key across pages`, async () => {
    const store = await makeStore();
    const keys = ["p/1", "p/2", "p/3", "p/4", "p/5"];
    for (const key of keys) await store.setJSON(key, {});
    const page = await store.list({ prefix: "p/" });
    assert.deepEqual(page.blobs.map((blob) => blob.key), keys);
    assert.deepEqual((await store.list()).blobs.map((blob) => blob.key), keys);
  });

  test(`${label}: paginate yields pages covering every key`, async () => {
    const store = await makeStore();
    const keys = ["p/1", "p/2", "p/3", "p/4", "p/5"];
    for (const key of keys) await store.setJSON(key, {});
    const seen = [];
    for await (const page of store.list({ prefix: "p/", paginate: true })) {
      seen.push(...page.blobs.map((blob) => blob.key));
    }
    assert.deepEqual(seen, keys);
  });
}
