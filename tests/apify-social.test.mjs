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
    if (url.includes("facebook-profile-posts-scraper") || url.includes("youtube-scraper")) return new Response(JSON.stringify([]));
    return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
  };

  const result = await refreshApifySocialRecords({ token: "test", fetchImpl });
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.failures, [
    { platform: "tiktok", status: 429, detail: '{"error":"rate limited"}' },
    { platform: "facebook", status: 204, detail: "No public posts were returned." },
    { platform: "youtube", status: 204, detail: "No public posts were returned." },
  ]);
});

test("Apify Facebook refresh uses public-profile rows for the linked Makeable profile", async () => {
  let facebookInput;
  const fetchImpl = async (url, options) => {
    if (!url.includes("facebook-profile-posts-scraper")) return new Response(JSON.stringify([]));
    facebookInput = JSON.parse(options.body);
    return new Response(JSON.stringify([{
      profile_id: "61593471075023", post_id: "fb-reel-1", created_time: "2026-08-29T00:00:00.000Z",
      video_views: 4_200, reactions_count: 120, comments_count: 8, shares_count: 5,
      type: "reel", message: "A Makeable reel", permalink_url: "https://www.facebook.com/reel/1",
    }]));
  };

  const { records } = await refreshApifySocialRecords({ token: "test", fetchImpl });
  const record = records.find((candidate) => candidate.platform === "facebook");
  assert.deepEqual({
    account: record?.account,
    attributionKey: record?.attributionKey,
    impressions: record?.impressions,
    engagements: record?.engagements,
  }, { account: "Makeable Facebook", attributionKey: "makeable_facebook", impressions: 4_200, engagements: 133 });
  assert.deepEqual(facebookInput, {
    endpoint: "profile_posts_by_id",
    profile_id: "61593471075023",
  });
});
