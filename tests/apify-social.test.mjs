import assert from "node:assert/strict";
import test from "node:test";
import { refreshApifySocialRecords } from "../lib/apify-social.mjs";
import { refreshSocialRecords } from "../lib/social-refresh.mjs";

test("official YouTube refresh uses public video counters without calling Apify", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.includes("/search?")) {
      return new Response(JSON.stringify({
        items: [{ id: { videoId: "latest-short" } }],
      }));
    }
    if (url.includes("/videos?")) {
      return new Response(JSON.stringify({
        items: [{
          id: "latest-short",
          snippet: {
            channelId: "UC6pzoYs0wo2XtyK7rYJ1ApQ",
            title: "Latest Makeable short",
            publishedAt: "2026-08-30T01:00:00.000Z",
            thumbnails: { high: { url: "https://i.ytimg.com/vi/latest-short/hqdefault.jpg" } },
          },
          statistics: { viewCount: "10000", likeCount: "300", commentCount: "18" },
        }],
      }));
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await refreshSocialRecords({ youtubeApiKey: "free-google-key", fetchImpl });

  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    id: "youtube:@makeablebuild:latest-short",
    platform: "youtube",
    account: "@makeablebuild",
    publishedAt: "2026-08-30T01:00:00.000Z",
    contentId: "latest-short",
    contentType: "video",
    caption: "Latest Makeable short",
    impressions: 10000,
    engagements: 318,
    followers: 0,
    followersGained: null,
    clicks: null,
    coverage: "public-snapshot",
    attributionKey: "makeable_youtube",
    engagementsComplete: false,
    thumbnailUrl: "https://i.ytimg.com/vi/latest-short/hqdefault.jpg",
    previewUrl: "",
    postUrl: "https://www.youtube.com/watch?v=latest-short",
  });
  assert.equal(requests.some((url) => url.includes("apify.com")), false);
});

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
    if (url.includes("facebook-posts-scraper") || url.includes("youtube-scraper")) return new Response(JSON.stringify([]));
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

test("Apify Facebook refresh uses official post rows for the linked Makeable profile", async () => {
  let facebookInput;
  const fetchImpl = async (url, options) => {
    if (!url.includes("facebook-posts-scraper")) return new Response(JSON.stringify([]));
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
    startUrls: [{ url: "https://www.facebook.com/profile.php?id=61593471075023" }],
    resultsLimit: 12,
    captionText: false,
  });
});
