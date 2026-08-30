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
  assert.deepEqual(requests.map((url) => new URL(url).host), [
    "www.googleapis.com",
    "www.googleapis.com",
  ]);
});

test("official refresh reports successful Meta and TikTok sources separately", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("graph.facebook.com") && url.includes("ig-build")) {
      return new Response(JSON.stringify({ data: [{
        id: "ig-post", caption: "Makeable reel", media_type: "REELS", timestamp: "2026-08-30T02:00:00+0000",
        permalink: "https://www.instagram.com/reel/ig-post/", thumbnail_url: "https://cdn.example/ig.jpg",
        like_count: 10, comments_count: 2, insights: { data: [{ name: "views", values: [{ value: 500 }] }] },
      }] }));
    }
    if (url.includes("open.tiktokapis.com")) {
      return new Response(JSON.stringify({ data: { videos: [{
        id: "tt-post", title: "Makeable TikTok", create_time: 1_788_131_600,
        cover_image_url: "https://cdn.example/tt.jpg", share_url: "https://www.tiktok.com/@trymakeable.build/video/tt-post",
        view_count: 700, like_count: 14, comment_count: 3, share_count: 2,
      }] } }));
    }
    if (url.includes("graph.facebook.com") && url.includes("page-1")) {
      return new Response(JSON.stringify({ data: [{
        id: "fb-post", message: "Makeable Facebook post", created_time: "2026-08-30T03:00:00+0000",
        permalink_url: "https://www.facebook.com/fb-post", full_picture: "https://cdn.example/fb.jpg",
        reactions: { summary: { total_count: 8 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 },
        insights: { data: [{ name: "post_impressions", values: [{ value: 600 }] }] },
      }] }));
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await refreshSocialRecords({
    metaAccessToken: "meta-token",
    instagramAccounts: [{ id: "ig-build", account: "@makeable.build", attributionKey: "makeable_build" }],
    tiktokAccessToken: "tiktok-token",
    facebookPageId: "page-1",
    fetchImpl,
  });

  assert.deepEqual(result.refreshedPlatforms, ["facebook", "instagram", "tiktok"]);
  assert.deepEqual(result.records.map((record) => [record.platform, record.impressions]), [
    ["facebook", 600],
    ["instagram", 500],
    ["tiktok", 700],
  ]);
});
