const FACEBOOK_GRAPH_API = "https://graph.facebook.com/v22.0";
const TIKTOK_API = "https://open.tiktokapis.com/v2";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
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
  if (string(options.youtubeApiKey)) sources.push({ platform: "youtube", run: () => refreshYouTubeRecords({ apiKey: options.youtubeApiKey, fetchImpl }) });
  const instagramAccounts = Array.isArray(options.instagramAccounts) ? options.instagramAccounts : [];
  if (string(options.metaAccessToken) && instagramAccounts.length) sources.push({ platform: "instagram", run: () => refreshInstagramRecords({ accessToken: options.metaAccessToken, accounts: instagramAccounts, fetchImpl }) });
  if (string(options.tiktokAccessToken)) sources.push({ platform: "tiktok", run: () => refreshTikTokRecords({ accessToken: options.tiktokAccessToken, fetchImpl }) });
  if (string(options.metaAccessToken) && string(options.facebookPageId)) sources.push({ platform: "facebook", run: () => refreshFacebookRecords({ accessToken: options.metaAccessToken, pageId: options.facebookPageId, fetchImpl }) });
  return sources;
}

async function refreshYouTubeRecords({ apiKey, fetchImpl }) {
  const search = queryUrl(`${YOUTUBE_API}/search`, { key: apiKey, part: "snippet", channelId: YOUTUBE_CHANNEL_ID, maxResults: "12", order: "date", type: "video" });
  const searchBody = await jsonRequest(search, "youtube", fetchImpl);
  const videoIds = Array.isArray(searchBody?.items) ? searchBody.items.map((item) => string(item?.id?.videoId)).filter(Boolean) : [];
  if (!videoIds.length) throw new SocialRefreshError("youtube", 204, "No public YouTube videos were returned.");
  const videos = queryUrl(`${YOUTUBE_API}/videos`, { key: apiKey, part: "snippet,statistics", id: videoIds.join(","), maxResults: "12" });
  const videosBody = await jsonRequest(videos, "youtube", fetchImpl);
  return requireRecords("youtube", Array.isArray(videosBody?.items) ? videosBody.items.map(normalizeYouTubeRecord).filter(Boolean) : []);
}

async function refreshInstagramRecords({ accessToken, accounts, fetchImpl }) {
  const result = await Promise.all(accounts.map(async (account) => {
    const accountId = string(account?.id);
    const accountName = string(account?.account);
    const attributionKey = string(account?.attributionKey);
    if (!accountId || !accountName || !attributionKey) throw new SocialRefreshError("instagram", 400, "Instagram account configuration is incomplete.");
    const url = queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(accountId)}/media`, {
      access_token: accessToken,
      fields: "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count,insights.metric(views,plays,impressions,reach,shares,saved)",
      limit: "12",
    });
    const body = await jsonRequest(url, "instagram", fetchImpl);
    return Array.isArray(body?.data) ? body.data.map((record) => normalizeInstagramRecord(record, accountName, attributionKey)).filter(Boolean) : [];
  }));
  return requireRecords("instagram", result.flat());
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

async function refreshFacebookRecords({ accessToken, pageId, fetchImpl }) {
  const url = queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(pageId)}/posts`, {
    access_token: accessToken,
    fields: "id,message,created_time,permalink_url,full_picture,reactions.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_engaged_users)",
    limit: "12",
  });
  const body = await jsonRequest(url, "facebook", fetchImpl);
  return requireRecords("facebook", (Array.isArray(body?.data) ? body.data : []).map(normalizeFacebookRecord).filter(Boolean));
}

function normalizeYouTubeRecord(video) {
  const contentId = string(video?.id);
  const publishedAt = timestamp(video?.snippet?.publishedAt);
  if (!contentId || !publishedAt || string(video?.snippet?.channelId) !== YOUTUBE_CHANNEL_ID) return null;
  const statistics = object(video?.statistics);
  return socialRecord({ platform: "youtube", account: "@makeablebuild", contentId, publishedAt, contentType: "video", caption: string(video?.snippet?.title), impressions: number(statistics.viewCount), engagements: number(statistics.likeCount) + number(statistics.commentCount), attributionKey: "makeable_youtube", thumbnailUrl: safeUrl(video?.snippet?.thumbnails?.high?.url || video?.snippet?.thumbnails?.medium?.url), postUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(contentId)}`, coverage: "public-snapshot" });
}

function normalizeInstagramRecord(record, account, attributionKey) {
  const permalink = safeUrl(record?.permalink);
  const contentId = instagramContentId(permalink) || string(record?.id);
  const publishedAt = timestamp(record?.timestamp);
  if (!contentId || !publishedAt) return null;
  return socialRecord({ platform: "instagram", account, contentId, publishedAt, contentType: string(record?.media_product_type || record?.media_type || "post").toLowerCase(), caption: string(record?.caption), impressions: insight(record?.insights, ["views", "plays", "impressions", "reach"]), engagements: number(record?.like_count) + number(record?.comments_count) + insight(record?.insights, ["shares", "saved"]), attributionKey, thumbnailUrl: safeUrl(record?.thumbnail_url || record?.media_url), postUrl: permalink, engagementsComplete: true });
}

function normalizeTikTokRecord(record, followers) {
  const contentId = string(record?.id);
  const publishedAt = unixTimestamp(record?.create_time);
  if (!contentId || !publishedAt) return null;
  return socialRecord({ platform: "tiktok", account: "@trymakeable.build", contentId, publishedAt, contentType: "video", caption: string(record?.title || record?.video_description), impressions: number(record?.view_count), engagements: number(record?.like_count) + number(record?.comment_count) + number(record?.share_count), followers, attributionKey: "trymakeable_build", thumbnailUrl: safeUrl(record?.cover_image_url), postUrl: safeUrl(record?.share_url || record?.embed_link), engagementsComplete: true });
}

function normalizeFacebookRecord(record) {
  const contentId = string(record?.id);
  const publishedAt = timestamp(record?.created_time);
  if (!contentId || !publishedAt) return null;
  return socialRecord({ platform: "facebook", account: "Makeable Facebook", contentId, publishedAt, contentType: "post", caption: string(record?.message), impressions: insight(record?.insights, ["post_impressions"]), engagements: number(record?.reactions?.summary?.total_count) + number(record?.comments?.summary?.total_count) + number(record?.shares?.count), attributionKey: "makeable_facebook", thumbnailUrl: safeUrl(record?.full_picture), postUrl: safeUrl(record?.permalink_url), engagementsComplete: true });
}

function socialRecord({ platform, account, contentId, publishedAt, contentType, caption, impressions, engagements, followers = 0, attributionKey, thumbnailUrl, postUrl, coverage = "connected", engagementsComplete = false }) {
  return { id: `${platform}:${account}:${contentId}`, platform, account, publishedAt, contentId, contentType, caption: caption.slice(0, 500), impressions, engagements, followers, followersGained: null, clicks: null, coverage, attributionKey, engagementsComplete, thumbnailUrl, previewUrl: "", postUrl };
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
function instagramContentId(permalink) { const match = permalink.match(/\/(?:p|reel)\/([^/?#]+)/); return match ? match[1] : ""; }
function unixTimestamp(value) { return timestamp(Number(value) * 1000); }
function timestamp(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function string(value) { return typeof value === "string" ? value.trim() : ""; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function safeUrl(value) { try { const url = new URL(string(value)); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }

class SocialRefreshError extends Error {
  constructor(platform, status, detail = "") {
    super(`${platform} refresh failed (${status}).`);
    this.platform = platform;
    this.status = status;
    this.detail = string(detail).replace(/\s+/g, " ").slice(0, 240);
  }
}

function refreshFailure(error) {
  return { platform: error instanceof SocialRefreshError ? error.platform : "social", status: error instanceof SocialRefreshError ? error.status : 0, ...(error instanceof SocialRefreshError && error.detail ? { detail: error.detail } : {}) };
}
