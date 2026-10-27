import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { decodeEntry, encodeValue } from "./memory-store.mjs";

// A store with the Netlify Blobs API, kept in S3 under "<name>/<key>".
// S3 reads are strongly consistent, so the `consistency` option is ignored.
export function createS3Store({ client, bucket, name, pageSize = 1000 }) {
  const root = `${name}/`;

  async function* pages(prefix = "") {
    let token;
    do {
      const result = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: root + prefix,
        MaxKeys: pageSize,
        ContinuationToken: token,
      }));
      const blobs = (result.Contents || []).map((object) => ({ key: object.Key.slice(root.length) }));
      yield { blobs, directories: [] };
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
  }

  return {
    async get(key, options = {}) {
      let result;
      try {
        result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: root + key }));
      } catch (error) {
        if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
      const bytes = await result.Body.transformToByteArray();
      return decodeEntry({ bytes, contentType: result.ContentType || "" }, options.type);
    },
    async set(key, value, options = {}) {
      const entry = await encodeValue(value, options.metadata);
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: root + key,
          Body: entry.bytes,
          ContentType: entry.contentType || undefined,
          Metadata: stringMetadata(entry.metadata),
          IfNoneMatch: options.onlyIfNew ? "*" : undefined,
        }));
      } catch (error) {
        if (options.onlyIfNew && error?.$metadata?.httpStatusCode === 412) return { modified: false };
        throw error;
      }
      return { modified: true };
    },
    async setJSON(key, value, options = {}) {
      return this.set(key, new Blob([JSON.stringify(value)], { type: "application/json" }), options);
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: root + key }));
    },
    list(options = {}) {
      if (options.paginate) return pages(options.prefix);
      return (async () => {
        const blobs = [];
        for await (const page of pages(options.prefix)) blobs.push(...page.blobs);
        return { blobs, directories: [] };
      })();
    },
  };
}

function stringMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, String(value)]));
}
