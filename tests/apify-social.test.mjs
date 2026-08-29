import assert from "node:assert/strict";
import test from "node:test";
import { refreshApifySocialRecords } from "../lib/apify-social.mjs";

test("Apify Instagram refresh prefers public play count over the lower video-view field", async () => {
  const fetchImpl = async (url) => new Response(JSON.stringify(url.includes("instagram-scraper") ? [{
    ownerUsername: "makeable.build", shortCode: "latest-reel", timestamp: "2026-08-28T17:17:52.000Z",
    videoPlayCount: 10_000, videoViewCount: 4_028, likesCount: 300, commentsCount: 18,
  }] : []));
  const [record] = await refreshApifySocialRecords({ token: "test", fetchImpl });
  assert.equal(record.impressions, 10_000);
});
