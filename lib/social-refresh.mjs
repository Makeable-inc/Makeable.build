import { refreshFacebookRecords, refreshInstagramRecords } from "./meta-social-refresh.mjs";
import { SocialRefreshError } from "./social-refresh-error.mjs";

const TIKTOK_API = "https://open.tiktokapis.com/v2";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
const YOUTUBE_CHANNEL_ID = "UC6pzoYs0wo2XtyK7rYJ1ApQ";
const SOURCE_TIMEOUT_MS = 15_000;

export async function refreshSocialRecords(options) {
  const sources = configuredSources(options);
  if (!sources.length) throw new SocialRefreshError("social", 401, "No official social connector is configured.");
  const results = await Promise.allSettled(sources.map((source) => source.run()));
  const successful = results.flatMap((result, index) => result.status === "fulfilled"
    ? [{ platform: sources[index].platform, records: result.value }] : []);
  const failures = results.flatMap((result) => result.status === "rejected" ? [refreshFailure(result.reason)] : []);
  const records = successful.flatMap((source) => source.records);
  if (!records.length) throw new Error(`Social refresh failed: ${failures.map((failure) => failure.platform).join(", ")}.`);
  return {
    records: records.sort((left, right) => left.platform.localeCompare(right.platform) || right.publishedAt.localeCompare(left.publishedAt)),
    failures,
    refreshedPlatforms: successful.map((source) => source.platform).sort(),
  };
}

function configuredSources(options) {
  const fetchImpl = options.fetchImpl || fetch;
  const sources = [];
  if (string(options.youtubeApiKey)) sources.push({ platform: "youtube", run: () => refreshYouTubeRecords({ apiKey: options.youtubeApiKey, accessToken: options.youtubeAccessToken, fetchImpl, now: options.now }) });
  const instagramAccounts = Array.isArray(options.instagramAccounts) ? options.instagramAccounts : [];
  if (string(options.metaAccessToken) && instagramAccounts.length) sources.push({ platform: "instagram", run: () => refreshInstagramRecords({ accessToken: options.metaAccessToken, accounts: instagramAccounts, fetchImpl, now: options.now }) });
  if (string(options.tiktokAccessToken)) sources.push({ platform: "tiktok", run: () => refreshTikTokRecords({ accessToken: options.tiktokAccessToken, fetchImpl }) });
  if (string(options.metaAccessToken) && string(options.facebookPageId)) sources.push({ platform: "facebook", run: () => refreshFacebookRecords({ accessToken: options.metaAccessToken, pageId: options.facebookPageId, fetchImpl, now: options.now }) });
  return sources;
}

async function refreshYouTubeRecords({ apiKey, accessToken, fetchImpl, now = new Date() }) {
  const search = queryUrl(`${YOUTUBE_API}/search`, { key: apiKey, part: "snippet", channelId: YOUTUBE_CHANNEL_ID, maxResults: "12", order: "date", type: "video" });
  const searchBody = await jsonRequest(search, "youtube", fetchImpl);
  const videoIds = Array.isArray(searchBody?.items) ? searchBody.items.map((item) => string(item?.id?.videoId)).filter(Boolean) : [];
  if (!videoIds.length) throw new SocialRefreshError("youtube", 204, "No public YouTube videos were returned.");
  const videos = queryUrl(`${YOUTUBE_API}/videos`, { key: apiKey, part: "snippet,statistics", id: videoIds.join(","), maxResults: "12" });
  const videosBody = await jsonRequest(videos, "youtube", fetchImpl);
  const publicVideos = Array.isArray(videosBody?.items) ? videosBody.items : [];
  if (!string(accessToken)) {
    return requireRecords("youtube", publicVideos.map((video) => normalizeYouTubeRecord(video)).filter(Boolean));
  }
  const owner = await loadYouTubeOwnerAnalytics({ accessToken, videoIds, fetchImpl, now });
  return requireRecords("youtube", publicVideos.map((video) => normalizeYouTubeRecord(video, owner)).filter(Boolean));
}

async function loadYouTubeOwnerAnalytics({ accessToken, videoIds, fetchImpl, now }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const endDate = calendarDate(now);
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 89);
  const channelUrl = queryUrl(`${YOUTUBE_API}/channels`, { part: "statistics", mine: "true" });
  const analyticsUrl = queryUrl(YOUTUBE_ANALYTICS_API, {
    ids: "channel==MINE",
    startDate: calendarDate(start),
    endDate,
    metrics: "views,likes,comments,shares,subscribersGained,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
    dimensions: "video",
    filters: `video==${videoIds.join(",")}`,
  });
  const [channelBody, analyticsBody] = await Promise.all([
    jsonRequest(channelUrl, "youtube", fetchImpl, headers),
    jsonRequest(analyticsUrl, "youtube", fetchImpl, headers),
  ]);
  return {
    followers: number(channelBody?.items?.[0]?.statistics?.subscriberCount),
    videos: analyticsRows(analyticsBody),
  };
}

async function refreshTikTokRecords({ accessToken, fetchImpl }) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const userUrl = queryUrl(`${TIKTOK_API}/user/info/`, { fields: "follower_count" });
  const videosUrl = queryUrl(`${TIKTOK_API}/video/list/`, { fields: "id,title,video_description,create_time,cover_image_url,share_url,embed_link,view_count,like_count,comment_count,share_count" });
  const [userBody, videosResponse] = await Promise.all([
    jsonRequest(userUrl, "tiktok", fetchImpl, headers),
    fetchImpl(videosUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ max_count: 20 }),
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    }),
  ]);
  if (!videosResponse.ok) throw new SocialRefreshError("tiktok", videosResponse.status, await videosResponse.text());
  const body = await videosResponse.json();
  const followers = number(userBody?.data?.user?.follower_count);
  return requireRecords("tiktok", (Array.isArray(body?.data?.videos) ? body.data.videos : []).map((record) => normalizeTikTokRecord(record, followers)).filter(Boolean));
}

function normalizeYouTubeRecord(video, owner = null) {
  const contentId = string(video?.id);
  const publishedAt = timestamp(video?.snippet?.publishedAt);
  if (!contentId || !publishedAt || string(video?.snippet?.channelId) !== YOUTUBE_CHANNEL_ID) return null;
  const statistics = object(video?.statistics);
  const analytics = owner?.videos?.get(contentId) || null;
  return socialRecord({
    platform: "youtube", account: "@makeablebuild", contentId, publishedAt, contentType: "video",
    caption: string(video?.snippet?.title), impressions: number(statistics.viewCount),
    engagements: analytics ? analytics.likes + analytics.comments + analytics.shares : number(statistics.likeCount) + number(statistics.commentCount),
    followers: owner?.followers || 0, followersGained: analytics?.subscribersGained ?? null,
    attributionKey: "makeable_youtube",
    thumbnailUrl: safeUrl(video?.snippet?.thumbnails?.high?.url || video?.snippet?.thumbnails?.medium?.url),
    postUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(contentId)}`,
    coverage: owner ? "connected" : "public-snapshot", engagementsComplete: Boolean(analytics),
    analytics: analytics ? {
      estimatedMinutesWatched: analytics.estimatedMinutesWatched,
      averageViewDuration: analytics.averageViewDuration,
      averageViewPercentage: analytics.averageViewPercentage,
    } : null,
  });
}

function normalizeTikTokRecord(record, followers) {
  const contentId = string(record?.id);
  const publishedAt = unixTimestamp(record?.create_time);
  if (!contentId || !publishedAt) return null;
  return socialRecord({ platform: "tiktok", account: "@trymakeable.build", contentId, publishedAt, contentType: "video", caption: string(record?.title || record?.video_description), impressions: number(record?.view_count), engagements: number(record?.like_count) + number(record?.comment_count) + number(record?.share_count), followers, attributionKey: "trymakeable_build", thumbnailUrl: safeUrl(record?.cover_image_url), postUrl: safeUrl(record?.share_url || record?.embed_link), engagementsComplete: true });
}

function socialRecord({ platform, account, contentId, publishedAt, contentType, caption, impressions, engagements, followers = 0, followersGained = null, clicks = null, attributionKey, thumbnailUrl, postUrl, coverage = "connected", engagementsComplete = false, analytics = null }) {
  return { id: `${platform}:${account}:${contentId}`, platform, account, publishedAt, contentId, contentType, caption: caption.slice(0, 500), impressions, engagements, followers, followersGained, clicks, coverage, attributionKey, engagementsComplete, thumbnailUrl, previewUrl: "", postUrl, ...(analytics ? { analytics } : {}) };
}

function analyticsRows(body) {
  const names = Array.isArray(body?.columnHeaders) ? body.columnHeaders.map((column) => string(column?.name)) : [];
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const index = (name) => names.indexOf(name);
  const values = new Map();
  rows.forEach((row) => {
    if (!Array.isArray(row)) return;
    const videoId = string(row[index("video")]);
    if (!videoId) return;
    values.set(videoId, {
      views: number(row[index("views")]),
      likes: number(row[index("likes")]),
      comments: number(row[index("comments")]),
      shares: number(row[index("shares")]),
      subscribersGained: number(row[index("subscribersGained")]),
      estimatedMinutesWatched: number(row[index("estimatedMinutesWatched")]),
      averageViewDuration: number(row[index("averageViewDuration")]),
      averageViewPercentage: number(row[index("averageViewPercentage")]),
    });
  });
  return values;
}

async function jsonRequest(url, platform, fetchImpl, headers = {}) {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (response.ok) return response.json();
  throw new SocialRefreshError(platform, response.status, await response.text());
}

function queryUrl(base, params) { const url = new URL(base); url.search = new URLSearchParams(params).toString(); return url.toString(); }
function requireRecords(platform, records) { if (records.length) return records; throw new SocialRefreshError(platform, 204, "No usable public posts were returned."); }
function insight(value, names) {
  const data = Array.isArray(value?.data) ? value.data : [];
  for (const name of names) {
    const metric = data.find((entry) => entry?.name === name);
    const latest = Array.isArray(metric?.values) ? metric.values.at(-1) : null;
    const total = number(latest?.value);
    if (total) return total;
  }
  return 0;
}
function unixTimestamp(value) { return timestamp(Number(value) * 1000); }
function timestamp(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; }
function calendarDate(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new SocialRefreshError("youtube", 400, "Invalid analytics date."); return date.toISOString().slice(0, 10); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function string(value) { return typeof value === "string" ? value.trim() : ""; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function safeUrl(value) { try { const url = new URL(string(value)); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }

function refreshFailure(error) {
  return { platform: error instanceof SocialRefreshError ? error.platform : "social", status: error instanceof SocialRefreshError ? error.status : 0, ...(error instanceof SocialRefreshError && error.detail ? { detail: error.detail } : {}) };
}
