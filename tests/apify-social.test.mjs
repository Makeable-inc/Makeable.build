import assert from "node:assert/strict";
import test from "node:test";
import { refreshApifySocialRecords } from "../lib/apify-social.mjs";

test("Apify Instagram refresh prefers public play count over the lower video-view field", async () => {
  const fetchImpl = async (url) => new Response(JSON.stringify(url.includes("instagram-scraper") ? [{
    ownerUsername: "makeable.build", shortCode: "latest-reel", timestamp: "2026-08-28T17:17:52.000Z",
    videoPlayCount: 10_000, videoViewCount: 4_028, likesCount: 300, commentsCount: 18,
  }] : []));
  const { records } = await refreshApifySocialRecords({ token: "test", fetchImpl });
  const [record] = records;
  assert.equal(record.impressions, 10_000);
});

test("Apify refresh keeps successful platform data when another platform is temporarily unavailable", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("instagram-scraper")) {
      return new Response(JSON.stringify([{
        ownerUsername: "makeable.build", shortCode: "still-live", timestamp: "2026-08-29T00:00:00.000Z",
        videoPlayCount: 12_000,
      }]));
    }
    return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
  };

  const result = await refreshApifySocialRecords({ token: "test", fetchImpl });
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.failures, [{ platform: "tiktok", status: 429 }]);
});
