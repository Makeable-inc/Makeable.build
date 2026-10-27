// Stands in for S3 at the network boundary. Mimics the S3 behaviours the
// store relies on: NoSuchKey, If-None-Match "*" (412), and paged listing.
export function createFakeS3Client() {
  const objects = new Map();

  function bucketObjects(bucket) {
    if (!objects.has(bucket)) objects.set(bucket, new Map());
    return objects.get(bucket);
  }

  function s3Error(name, httpStatusCode) {
    return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
  }

  return {
    objects,
    async send(command) {
      const input = command.input;
      const bucket = bucketObjects(input.Bucket);
      switch (command.constructor.name) {
        case "GetObjectCommand": {
          const object = bucket.get(input.Key);
          if (!object) throw s3Error("NoSuchKey", 404);
          return {
            ContentType: object.ContentType,
            Metadata: object.Metadata,
            Body: { transformToByteArray: async () => object.Body.slice() },
          };
        }
        case "PutObjectCommand": {
          if (input.IfNoneMatch === "*" && bucket.has(input.Key)) {
            throw s3Error("PreconditionFailed", 412);
          }
          bucket.set(input.Key, {
            Body: new Uint8Array(input.Body),
            ContentType: input.ContentType,
            Metadata: input.Metadata || {},
          });
          return {};
        }
        case "DeleteObjectCommand":
          bucket.delete(input.Key);
          return {};
        case "ListObjectsV2Command": {
          const keys = [...bucket.keys()].filter((key) => key.startsWith(input.Prefix || "")).sort();
          const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
          const end = start + (input.MaxKeys || 1000);
          return {
            Contents: keys.slice(start, end).map((Key) => ({ Key })),
            IsTruncated: end < keys.length,
            NextContinuationToken: end < keys.length ? String(end) : undefined,
          };
        }
        default:
          throw new Error(`Fake S3 does not support ${command.constructor.name}`);
      }
    },
  };
}
