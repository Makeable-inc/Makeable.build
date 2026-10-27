import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryStore } from "../lib/storage/memory-store.mjs";
import { createS3Store } from "../lib/storage/s3-store.mjs";
import { createFakeS3Client } from "./helpers/fake-s3-client.mjs";
import { runStoreContract } from "./helpers/store-contract.mjs";

runStoreContract("memory", () => createMemoryStore());

runStoreContract("s3", () =>
  createS3Store({ client: createFakeS3Client(), bucket: "test-bucket", name: "jobs", pageSize: 2 }),
);

test("s3: object key is <store name>/<key>", async () => {
  const client = createFakeS3Client();
  const store = createS3Store({ client, bucket: "test-bucket", name: "makeable-build-jobs" });
  await store.setJSON("job-1", { id: 1 });
  assert.deepEqual([...client.objects.get("test-bucket").keys()], ["makeable-build-jobs/job-1"]);
});

test("s3: a concurrent-write conflict on onlyIfNew counts as not modified", async () => {
  const client = createFakeS3Client();
  const realSend = client.send;
  client.send = async (command) => {
    if (command.constructor.name === "PutObjectCommand" && command.input.IfNoneMatch === "*") {
      throw Object.assign(new Error("ConditionalRequestConflict"), {
        name: "ConditionalRequestConflict",
        $metadata: { httpStatusCode: 409 },
      });
    }
    return realSend(command);
  };
  const store = createS3Store({ client, bucket: "test-bucket", name: "waitlist" });
  assert.deepEqual(await store.setJSON("signup-1", { v: 1 }, { onlyIfNew: true }), { modified: false });
});
