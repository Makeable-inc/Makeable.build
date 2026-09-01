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
    embedUrl: "https://www.youtube.com/embed/latest-short",
    postUrl: "https://www.youtube.com/watch?v=latest-short",
  });
  assert.deepEqual(requests.map((url) => new URL(url).host), [
    "www.googleapis.com",
    "www.googleapis.com",
  ]);
});

test("YouTube owner refresh keeps public play counts and adds private engagement and subscriber metrics", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    if (parsed.pathname.endsWith("/search")) {
      return Response.json({ items: [{ id: { videoId: "latest-short" } }] });
    }
    if (parsed.pathname.endsWith("/videos")) {
      return Response.json({ items: [{
        id: "latest-short",
        snippet: {
          channelId: "UC6pzoYs0wo2XtyK7rYJ1ApQ",
          title: "Latest Makeable short",
          publishedAt: "2026-08-30T01:00:00.000Z",
          thumbnails: { high: { url: "https://i.ytimg.com/vi/latest-short/hqdefault.jpg" } },
        },
        statistics: { viewCount: "10000", likeCount: "300", commentCount: "18" },
      }] });
    }
    if (parsed.pathname.endsWith("/channels")) {
      assert.equal(options.headers.Authorization, "Bearer owner-access");
      assert.equal(parsed.searchParams.get("mine"), "true");
      return Response.json({ items: [{ statistics: { subscriberCount: "128" } }] });
    }
    if (parsed.hostname === "youtubeanalytics.googleapis.com") {
      assert.equal(options.headers.Authorization, "Bearer owner-access");
      assert.equal(parsed.searchParams.get("ids"), "channel==MINE");
      assert.equal(parsed.searchParams.get("dimensions"), "video");
      assert.match(parsed.searchParams.get("metrics"), /subscribersGained/);
      return Response.json({
        columnHeaders: [
          { name: "video" }, { name: "views" }, { name: "likes" }, { name: "comments" },
          { name: "shares" }, { name: "subscribersGained" }, { name: "estimatedMinutesWatched" },
          { name: "averageViewDuration" }, { name: "averageViewPercentage" },
        ],
        rows: [["latest-short", 9980, 302, 18, 11, 7, 2400, 42, 64.5]],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await refreshSocialRecords({
    youtubeApiKey: "free-google-key",
    youtubeAccessToken: "owner-access",
    fetchImpl,
  });

  assert.equal(result.records[0].impressions, 10000);
  assert.equal(result.records[0].engagements, 331);
  assert.equal(result.records[0].followers, 128);
  assert.equal(result.records[0].followersGained, 7);
  assert.equal(result.records[0].coverage, "connected");
  assert.equal(result.records[0].engagementsComplete, true);
  assert.deepEqual(result.records[0].analytics, {
    estimatedMinutesWatched: 2400,
    averageViewDuration: 42,
    averageViewPercentage: 64.5,
  });
  assert.equal(requests.length, 4);
});

test("official refresh reports successful Meta and TikTok sources separately", async () => {
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/ig-build/insights")) {
      return parsed.searchParams.get("metric") === "follows_and_unfollows"
        ? Response.json({ data: [{ total_value: { breakdowns: [{ results: [] }] } }] })
        : Response.json({ data: [{ total_value: { value: 0 } }] });
    }
    if (parsed.pathname.endsWith("/ig-build")) {
      return Response.json({ followers_count: 23, media_count: 1 });
    }
    if (parsed.pathname.endsWith("/ig-build/media")) {
      return new Response(JSON.stringify({ data: [{
        id: "ig-post", caption: "Makeable reel", media_type: "REELS", timestamp: "2026-08-30T02:00:00+0000",
        permalink: "https://www.instagram.com/reel/ig-post/", thumbnail_url: "https://cdn.example/ig.jpg",
        like_count: 10, comments_count: 2,
      }] }));
    }
    if (parsed.pathname.endsWith("/ig-post/insights")) {
      return Response.json({ data: [
        { name: "views", values: [{ value: 500 }] },
        { name: "total_interactions", values: [{ value: 14 }] },
      ] });
    }
    if (url.includes("open.tiktokapis.com") && url.includes("/user/info/")) {
      assert.equal(options.method, undefined);
      return Response.json({ data: { user: { follower_count: 42 } } });
    }
    if (url.includes("open.tiktokapis.com") && url.includes("/video/list/")) {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { max_count: 20 });
      return new Response(JSON.stringify({ data: { videos: [{
        id: "tt-post", title: "Makeable TikTok", create_time: 1_788_131_600,
        cover_image_url: "https://cdn.example/tt.jpg", share_url: "https://www.tiktok.com/@trymakeable.build/video/tt-post", embed_link: "https://www.tiktok.com/player/v1/tt-post",
        view_count: 700, like_count: 14, comment_count: 3, share_count: 2,
      }] } }));
    }
    if (parsed.pathname.endsWith("/page-1")) {
      return Response.json({ access_token: "page-token", followers_count: 4, fan_count: 3 });
    }
    if (parsed.pathname.endsWith("/page-1/insights")) {
      return Response.json({ data: [
        { name: "page_daily_follows", values: [{ value: 0 }] },
        { name: "page_daily_unfollows", values: [{ value: 0 }] },
      ] });
    }
    if (parsed.pathname.endsWith("/page-1/posts")) {
      return new Response(JSON.stringify({ data: [{
        id: "fb-post", message: "Makeable Facebook post", created_time: "2026-08-30T03:00:00+0000",
        permalink_url: "https://www.facebook.com/fb-post", full_picture: "https://cdn.example/fb.jpg",
        reactions: { summary: { total_count: 8 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 },
      }] }));
    }
    if (parsed.pathname.endsWith("/fb-post/insights")) {
      return Response.json({ data: [{ name: "post_media_view", values: [{ value: 600 }] }] });
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
  assert.equal(result.records.find((record) => record.platform === "tiktok").followers, 42);
  assert.equal(result.records.find((record) => record.platform === "tiktok").embedUrl, "https://www.tiktok.com/player/v1/tt-post");
});

test("Meta refresh uses current per-content insights without dropping Facebook or Instagram", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.pathname.endsWith("/ig-build/insights")) {
      if (parsed.searchParams.get("metric") === "follows_and_unfollows") {
        assert.equal(parsed.searchParams.get("metric_type"), "total_value");
        assert.equal(parsed.searchParams.get("breakdown"), "follow_type");
        return Response.json({ data: [{ total_value: { breakdowns: [{
          dimension_keys: ["follow_type"],
          results: [
            { dimension_values: ["FOLLOWER"], value: 156 },
            { dimension_values: ["NON_FOLLOWER"], value: 1 },
          ],
        }] } }] });
      }
      assert.equal(parsed.searchParams.get("metric"), "website_clicks");
      assert.equal(parsed.searchParams.get("metric_type"), "total_value");
      return Response.json({ data: [{ total_value: { value: 112 } }] });
    }
    if (parsed.pathname.endsWith("/ig-build")) {
      assert.equal(parsed.searchParams.get("fields"), "followers_count,media_count");
      return Response.json({ followers_count: 235, media_count: 8 });
    }
    if (parsed.pathname.endsWith("/ig-build/media")) {
      assert.doesNotMatch(parsed.searchParams.get("fields"), /insights\.metric/);
      return Response.json({ data: [{
        id: "ig-post",
        caption: "Makeable reel",
        media_type: "VIDEO",
        media_product_type: "REELS",
        timestamp: "2026-08-30T02:00:00+0000",
        permalink: "https://www.instagram.com/reel/ig-post/",
        thumbnail_url: "https://cdn.example/ig.jpg",
        media_url: "https://cdn.example/ig.mp4",
        like_count: 18,
        comments_count: 1,
      }] });
    }
    if (parsed.pathname.endsWith("/ig-post/insights")) {
      assert.equal(parsed.searchParams.get("metric"), "views,reach,shares,saved,total_interactions");
      return Response.json({ data: [
        { name: "views", values: [{ value: 803 }] },
        { name: "reach", values: [{ value: 647 }] },
        { name: "shares", values: [{ value: 2 }] },
        { name: "saved", values: [{ value: 21 }] },
        { name: "total_interactions", values: [{ value: 46 }] },
      ] });
    }
    if (parsed.pathname.endsWith("/page-1")) {
      assert.equal(parsed.searchParams.get("fields"), "access_token,followers_count,fan_count");
      return Response.json({ access_token: "page-token", followers_count: 12, fan_count: 10 });
    }
    if (parsed.pathname.endsWith("/page-1/insights")) {
      assert.equal(parsed.searchParams.get("metric"), "page_daily_follows,page_daily_unfollows");
      return Response.json({ data: [
        { name: "page_daily_follows", values: [{ value: 0 }] },
        { name: "page_daily_unfollows", values: [{ value: 0 }] },
      ] });
    }
    if (parsed.pathname.endsWith("/page-1/posts")) {
      assert.doesNotMatch(parsed.searchParams.get("fields"), /insights\.metric/);
      return Response.json({ data: [{
        id: "fb-post",
        message: "Makeable Facebook post",
        created_time: "2026-08-30T03:00:00+0000",
        permalink_url: "https://www.facebook.com/fb-post",
        full_picture: "https://cdn.example/fb.jpg",
        attachments: { data: [{ media_type: "video_inline", url: "https://www.facebook.com/fb-post" }] },
        reactions: { summary: { total_count: 8 } },
        comments: { summary: { total_count: 2 } },
        shares: { count: 1 },
      }] });
    }
    if (parsed.pathname.endsWith("/fb-post/insights")) {
      assert.equal(parsed.searchParams.get("metric"), "post_media_view,post_clicks");
      return Response.json({ data: [
        { name: "post_media_view", values: [{ value: 600 }] },
        { name: "post_clicks", values: [{ value: 9 }] },
      ] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await refreshSocialRecords({
    metaAccessToken: "meta-token",
    instagramAccounts: [{ id: "ig-build", account: "@makeable.build", attributionKey: "makeable_build" }],
    facebookPageId: "page-1",
    fetchImpl,
    now: new Date("2026-08-31T12:00:00.000Z"),
  });

  assert.deepEqual(result.refreshedPlatforms, ["facebook", "instagram"]);
  assert.deepEqual(result.records.map((record) => ({
    platform: record.platform,
    impressions: record.impressions,
    engagements: record.engagements,
    followers: record.followers,
    clicks: record.clicks,
  })), [
    { platform: "facebook", impressions: 600, engagements: 11, followers: 12, clicks: 9 },
    { platform: "instagram", impressions: 803, engagements: 46, followers: 235, clicks: null },
  ]);
  assert.deepEqual(result.records.find((record) => record.platform === "instagram").accountAnalytics, {
    7: { clicks: 112, followersGained: 156 },
    30: { clicks: 112, followersGained: 156 },
    90: { clicks: 336, followersGained: 468 },
  });
  assert.deepEqual(result.records.find((record) => record.platform === "facebook").accountAnalytics, {
    7: { followersGained: 0 },
    30: { followersGained: 0 },
    90: { followersGained: 0 },
  });
  assert.equal(result.records.find((record) => record.platform === "instagram").previewUrl, "https://cdn.example/ig.mp4");
  assert.match(result.records.find((record) => record.platform === "facebook").embedUrl, /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?/);
  assert.equal(requests.length, 19);
});
