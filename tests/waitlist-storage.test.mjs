import assert from "node:assert/strict";
import test from "node:test";
import { getStore } from "@netlify/blobs";

import {
  deliverWebhook,
  persistVerifiedWaitlistRecord,
  waitlistSignupKey,
  waitlistStoreName,
  waitlistStoreNameForFunctionContext,
} from "../lib/waitlist-storage.mjs";
import {
  readVerifiedWaitlist,
  waitlistCsv,
} from "../lib/waitlist-report.mjs";

const record = {
  email: "maker@example.com",
  source: "google",
  createdAt: "2026-07-20T12:00:00.000Z",
  name: "Maker",
};

class MemoryStore {
  constructor() {
    this.values = new Map();
    this.pending = new Map();
  }

  async set(key, value, options) {
    assert.deepEqual(options, { onlyIfNew: true });
    if (this.values.has(key)) {
      await this.pending.get(key);
      return { modified: false };
    }
    let markReady;
    const ready = new Promise((resolve) => {
      markReady = resolve;
    });
    this.pending.set(key, ready);
    this.values.set(key, null);
    try {
      this.values.set(key, JSON.parse(await value.text()));
    } finally {
      markReady();
      this.pending.delete(key);
    }
    return { modified: true, etag: "test-etag" };
  }

  async get(key, options) {
    assert.equal(options.type, "json");
    await this.pending.get(key);
    return this.values.get(key) || null;
  }

  async *list() {
    yield {
      blobs: [...this.values.keys()].map((key) => ({ key, etag: "test-etag" })),
      directories: [],
    };
  }
}

test("verified signup storage is atomic and preserves the original record", async () => {
  const store = new MemoryStore();
  const results = await Promise.all(
    Array.from({ length: 50 }, () => persistVerifiedWaitlistRecord(record, { store })),
  );

  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(store.values.size, 1);
  assert.deepEqual(store.values.get(waitlistSignupKey(record.email)), record);

  const later = { ...record, createdAt: "2026-07-21T12:00:00.000Z", name: "Changed" };
  const duplicate = await persistVerifiedWaitlistRecord(later, { store });
  assert.equal(duplicate.created, false);
  assert.deepEqual(store.values.get(waitlistSignupKey(record.email)), record);
});

test("production and deploy-preview waitlists are isolated", () => {
  assert.equal(waitlistStoreName("production"), "waitlist");
  assert.equal(waitlistStoreName("deploy-preview"), "waitlist-preview");
  assert.equal(waitlistStoreName("branch-deploy"), "waitlist-preview");
  assert.equal(waitlistStoreName(""), "waitlist");
  assert.equal(
    waitlistStoreNameForFunctionContext({ deploy: { context: "production" } }),
    "waitlist",
  );
  assert.equal(
    waitlistStoreNameForFunctionContext({ deploy: { context: "deploy-preview" } }),
    "waitlist-preview",
  );
  assert.equal(waitlistStoreNameForFunctionContext({}), "waitlist");
});

test("the pinned Netlify client sends the atomic create-only header", async () => {
  let capturedWrite;
  let storedRecord;
  const store = getStore({
    name: "waitlist",
    siteID: "test-site",
    token: "test-token",
    consistency: "strong",
    edgeURL: "https://blobs.example.com",
    uncachedEdgeURL: "https://blobs.example.com",
    fetch: async (url, options) => {
      if (options.method === "put") {
        capturedWrite = { url, options };
        storedRecord = JSON.parse(await options.body.text());
      }
      if (options.method === "get") {
        return Response.json(storedRecord, { status: 200 });
      }
      return new Response(null, {
        status: 200,
        headers: { ETag: "test-etag" },
      });
    },
  });

  const result = await persistVerifiedWaitlistRecord(record, { store });
  assert.equal(result.created, true);
  assert.equal(capturedWrite.options.method, "put");
  assert.equal(capturedWrite.options.headers["if-none-match"], "*");
  assert.equal(capturedWrite.options.body.type, "application/json");
  assert.deepEqual(storedRecord, record);
});

test("the pinned Netlify client cannot turn a rejected write into signup success", async () => {
  const store = getStore({
    name: "waitlist",
    siteID: "test-site",
    token: "test-token",
    consistency: "strong",
    edgeURL: "https://blobs.example.com",
    uncachedEdgeURL: "https://blobs.example.com",
    fetch: async () => new Response(null, { status: 403 }),
  });

  await assert.rejects(
    persistVerifiedWaitlistRecord(record, { store }),
    /Netlify Blobs has generated an internal error|could not be verified/,
  );
});

test("webhook replication happens after persistence and uses signed idempotent delivery", async () => {
  const store = new MemoryStore();
  let background;
  let request;
  const result = await persistVerifiedWaitlistRecord(record, {
    store,
    webhookUrl: "https://hooks.example.com/waitlist",
    webhookSecret: "test-secret",
    waitUntil(promise) {
      background = promise;
    },
    fetchImpl: async (url, options) => {
      assert.equal(store.values.has(waitlistSignupKey(record.email)), true);
      request = { url, options };
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(result.created, true);
  await background;
  assert.equal(request.url, "https://hooks.example.com/waitlist");
  assert.equal(request.options.headers["Idempotency-Key"], waitlistSignupKey(record.email));
  assert.match(request.options.headers["X-Makeable-Signature"], /^v1=[a-f0-9]{64}$/);
  assert.equal(request.options.body, JSON.stringify(record));
});

test("webhook failures cannot erase the durable signup", async () => {
  const store = new MemoryStore();
  let background;
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await persistVerifiedWaitlistRecord(record, {
      store,
      webhookUrl: "https://hooks.example.com/waitlist",
      webhookSecret: "test-secret",
      waitUntil(promise) {
        background = promise;
      },
      fetchImpl: async () => new Response(null, { status: 500 }),
    });
    assert.equal(result.created, true);
    await background;
    assert.deepEqual(store.values.get(waitlistSignupKey(record.email)), record);
  } finally {
    console.error = originalError;
  }
});

test("webhook configuration requires HTTPS and a signing secret", async () => {
  await assert.rejects(
    deliverWebhook(record, "event", {
      webhookUrl: "http://hooks.example.com/waitlist",
      webhookSecret: "secret",
      fetchImpl: async () => new Response(null, { status: 204 }),
      retryDelaysMs: [0],
    }),
    /HTTPS/,
  );
  await assert.rejects(
    deliverWebhook(record, "event", {
      webhookUrl: "https://hooks.example.com/waitlist",
      webhookSecret: "",
      fetchImpl: async () => new Response(null, { status: 204 }),
      retryDelaysMs: [0],
    }),
    /WAITLIST_WEBHOOK_SECRET/,
  );
});

test("owner export returns only verified records and formula-safe CSV", async () => {
  const store = new MemoryStore();
  store.values.set("signup-1", record);
  store.values.set("signup-2", {
    email: "attacker@example.com",
    source: "email",
    createdAt: record.createdAt,
  });
  store.values.set("signup-3", {
    ...record,
    email: "second@example.com",
    name: "=HYPERLINK(\"https://example.com\")",
  });
  store.values.set("build-interest-1", {
    email: "builder@example.com",
    name: "",
    source: "make-a-build",
    createdAt: record.createdAt,
  });

  const records = await readVerifiedWaitlist(store);
  assert.equal(records.length, 3);
  const csv = waitlistCsv(records);
  assert.match(csv, /^email,name,source,created_at\n/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
  assert.match(csv, /builder@example\.com/);
  assert.doesNotMatch(csv, /attacker/);
});
