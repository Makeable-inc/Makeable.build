import assert from "node:assert/strict";
import test from "node:test";
import { refreshSocialRecords } from "../lib/social-refresh.mjs";

test("official YouTube refresh uses public video counters without calling paid collectors", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.includes("/search?")) {
      return new Response(JSON.stringify({ items: [{ id: { videoId: "latest-short" } }] }));
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

  const result = await refreshSocialRecords({
    youtubeApiKey: "free-google-key",
    fetchImpl,
  });

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
  assert.equal(requests.some((url) => url.includes("apify")), false);
});
