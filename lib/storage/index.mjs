import { S3Client } from "@aws-sdk/client-s3";
import { getStore } from "@netlify/blobs";
import { createMemoryStore } from "./memory-store.mjs";
import { createS3Store } from "./s3-store.mjs";

const memoryStores = new Map();
let sharedS3Client;

// Opens a named store on the backend chosen by MAKEABLE_STORAGE_BACKEND.
// Unset means Netlify Blobs, so Netlify deploys behave exactly as before.
export function openStore(
  { name, consistency },
  { env = process.env, s3Client, getNetlifyStore = getStore } = {},
) {
  const backend = env.MAKEABLE_STORAGE_BACKEND;
  if (!backend || backend === "netlify") return getNetlifyStore({ name, consistency });
  if (backend === "memory") {
    if (!memoryStores.has(name)) memoryStores.set(name, createMemoryStore());
    return memoryStores.get(name);
  }
  if (backend === "s3") {
    const bucket = env.MAKEABLE_STORAGE_BUCKET;
    if (!bucket) throw new Error("MAKEABLE_STORAGE_BUCKET is required when MAKEABLE_STORAGE_BACKEND=s3");
    const client = s3Client || (sharedS3Client ??= new S3Client({}));
    return createS3Store({ client, bucket, name });
  }
  throw new Error(`Unknown MAKEABLE_STORAGE_BACKEND "${backend}"`);
}
