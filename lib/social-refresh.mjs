const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_CHANNEL_ID = "UC6pzoYs0wo2XtyK7rYJ1ApQ";
const SOURCE_TIMEOUT_MS = 15_000;

export async function refreshSocialRecords({ youtubeApiKey = "", fetchImpl = fetch }) {
  if (!youtubeApiKey) {
    throw new SocialRefreshError("youtube", 401, "YouTube API key is not configured.");
  }
  return refreshYouTubeRecords({ apiKey: youtubeApiKey, fetchImpl });
}

async function refreshYouTubeRecords({ apiKey, fetchImpl }) {
  const search = new URL(`${YOUTUBE_API}/search`);
  search.search = new URLSearchParams({
    key: apiKey,
    part: "snippet",
    channelId: YOUTUBE_CHANNEL_ID,
    maxResults: "12",
    order: "date",
    type: "video",
  }).toString();
  const searchResponse = await request(search, "youtube", fetchImpl);
  const searchBody = await searchResponse.json();
  const videoIds = Array.isArray(searchBody?.items)
    ? searchBody.items.map((item) => string(item?.id?.videoId)).filter(Boolean)
    : [];
  if (!videoIds.length) throw new SocialRefreshError("youtube", 204, "No public YouTube videos were returned.");

  const videos = new URL(`${YOUTUBE_API}/videos`);
  videos.search = new URLSearchParams({
    key: apiKey,
    part: "snippet,statistics",
    id: videoIds.join(","),
    maxResults: "12",
  }).toString();
  const videosResponse = await request(videos, "youtube", fetchImpl);
  const videosBody = await videosResponse.json();
  const records = Array.isArray(videosBody?.items)
    ? videosBody.items.map(normalizeYouTubeRecord).filter(Boolean)
    : [];
  if (!records.length) throw new SocialRefreshError("youtube", 204, "No usable YouTube video statistics were returned.");
  return { records, failures: [] };
}

async function request(url, platform, fetchImpl) {
  const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (response.ok) return response;
  throw new SocialRefreshError(platform, response.status, await response.text());
}

function normalizeYouTubeRecord(video) {
  const contentId = string(video?.id);
  const publishedAt = timestamp(video?.snippet?.publishedAt);
  if (!contentId || !publishedAt || string(video?.snippet?.channelId) !== YOUTUBE_CHANNEL_ID) return null;
  const statistics = video.statistics || {};
  return {
    id: `youtube:@makeablebuild:${contentId}`,
    platform: "youtube",
    account: "@makeablebuild",
    publishedAt,
    contentId,
    contentType: "video",
    caption: string(video?.snippet?.title).slice(0, 500),
    impressions: number(statistics.viewCount),
    engagements: number(statistics.likeCount) + number(statistics.commentCount),
    followers: 0,
    followersGained: null,
    clicks: null,
    coverage: "public-snapshot",
    attributionKey: "makeable_youtube",
    engagementsComplete: false,
    thumbnailUrl: safeUrl(video?.snippet?.thumbnails?.high?.url || video?.snippet?.thumbnails?.medium?.url),
    previewUrl: "",
    postUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(contentId)}`,
  };
}

class SocialRefreshError extends Error {
  constructor(platform, status, detail = "") {
    super(`${platform} refresh failed (${status}).`);
    this.platform = platform;
    this.status = status;
    this.detail = string(detail).replace(/\s+/g, " ").slice(0, 240);
  }
}

function timestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeUrl(value) {
  try {
    const url = new URL(string(value));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}
