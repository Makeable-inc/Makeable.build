const APIFY_API = "https://api.apify.com/v2/acts";
const SOURCE_TIMEOUT_MS = 20_000;

const ACCOUNTS = Object.freeze([
  {
    actor: "apify~instagram-scraper",
    input: {
      directUrls: [
        "https://www.instagram.com/makeable.build/",
        "https://www.instagram.com/makeable.zak/",
      ],
      resultsLimit: 12,
    },
    platform: "instagram",
  },
  {
    actor: "clockworks~tiktok-scraper",
    input: {
      profiles: ["trymakeable.build"],
      profileScrapeSections: ["videos"],
      profileSorting: "latest",
      resultsPerPage: 12,
      shouldDownloadAvatars: false,
      shouldDownloadCovers: false,
      shouldDownloadMusicCovers: false,
      shouldDownloadSlideshowImages: false,
      shouldDownloadSubtitles: false,
      shouldDownloadVideos: false,
    },
    platform: "tiktok",
  },
  {
    actor: "chronometrica~facebook-metrics-scraper",
    input: {
      mode: "profileUrls",
      startUrls: ["https://www.facebook.com/profile.php?id=61593471075023"],
      maxItemsPerProfile: 12,
      includePosts: true,
      includeReels: true,
      includeVideos: true,
      includePhotos: false,
      includeAuthorProfileMetrics: true,
      maxConcurrency: 2,
      requestTimeoutSecs: 15,
    },
    platform: "facebook",
  },
]);

export async function refreshApifySocialRecords({ token, fetchImpl = fetch }) {
  if (!token) throw new Error("Apify is not configured for this dashboard.");
  const results = await Promise.allSettled(ACCOUNTS.map(async (source) => {
    const response = await fetchImpl(
      `${APIFY_API}/${source.actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&clean=true`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(source.input),
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new ApifyRefreshError(source.platform, response.status, await response.text());
    const rows = await response.json();
    return Array.isArray(rows) ? rows.map((row) => normalizeRecord(source.platform, row)).filter(Boolean) : [];
  }));
  const successful = results.filter((result) => result.status === "fulfilled");
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [refreshFailure(ACCOUNTS[index].platform, result.reason)] : []);
  if (successful.length === 0) throw new Error(`Apify refresh failed: ${failures.map((failure) => failure.platform).join(", ")}.`);
  return {
    records: successful.flatMap((result) => result.value).sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)),
    failures,
  };
}

class ApifyRefreshError extends Error {
  constructor(platform, status, detail = "") {
    super(`Apify ${platform} refresh failed (${status}).`);
    this.platform = platform;
    this.status = status;
    this.detail = string(detail).replace(/\s+/g, " ").slice(0, 240);
  }
}

function refreshFailure(platform, error) {
  return {
    platform,
    status: error instanceof ApifyRefreshError ? error.status : 0,
    ...(error instanceof ApifyRefreshError && error.detail ? { detail: error.detail } : {}),
  };
}

function normalizeRecord(platform, row) {
  const account = accountFor(platform, row);
  const contentId = string(platform === "instagram" ? row.shortCode || row.id
    : platform === "facebook" ? row.contentId || row.postId || row.id : row.id || row.videoId);
  const publishedAt = timestamp(platform === "instagram" ? row.timestamp
    : platform === "facebook" ? row.publishedAt || row.timestampMs || row.timestamp || row.createdAt : row.createTimeISO || row.createTime);
  if (!account || !contentId || !publishedAt) return null;
  const impressions = number(platform === "instagram" ? row.videoPlayCount || row.videoViewCount
    : platform === "facebook" ? row.plays || row.views || row.viewsCount || row.viewCount : row.playCount);
  const engagements = number(platform === "instagram"
    ? number(row.likesCount) + number(row.commentsCount)
    : platform === "facebook"
      ? number(row.likes || row.likesCount) + number(row.comments || row.commentsCount) + number(row.shares || row.sharesCount)
    : number(row.diggCount) + number(row.commentCount) + number(row.shareCount));
  return {
    id: `${platform}:${account}:${contentId}`, platform, account, publishedAt, contentId,
    contentType: platform === "instagram" ? string(row.productType || row.type || "post")
      : platform === "facebook" ? string(row.contentType || (row.isVideo ? "video" : "post")) : "video",
    caption: string(platform === "instagram" ? row.caption : row.text).slice(0, 500),
    impressions, engagements, followers: number(platform === "instagram" ? row.ownerFollowersCount
      : platform === "facebook" ? row.profileFollowers || row.followersCount : row.authorMeta?.fans),
    followersGained: null, clicks: null, coverage: "public-snapshot", attributionKey: attributionKey(platform, account),
    engagementsComplete: false,
    thumbnailUrl: safeUrl(platform === "instagram" ? row.displayUrl
      : platform === "facebook" ? row.thumbnailUrl || row.videoThumbnailUrl || row.images?.[0] : row.videoMeta?.coverUrl),
    previewUrl: safeUrl(platform === "instagram" ? row.videoUrl : platform === "facebook" ? row.videoUrl || row.videoDownloadUrl : row.videoMeta?.downloadAddr),
    postUrl: safeUrl(platform === "instagram" ? row.url : platform === "facebook" ? row.contentUrl || row.postUrl : row.webVideoUrl),
  };
}

function accountFor(platform, row) {
  const value = string(platform === "instagram" ? row.ownerUsername : row.authorMeta?.name).replace(/^@/, "");
  if (platform === "instagram" && ["makeable.build", "makeable.zak"].includes(value)) return `@${value}`;
  if (platform === "tiktok" && value === "trymakeable.build") return `@${value}`;
  if (platform === "facebook" && (
    String(row.profileId || row.pageId || "") === "61593471075023"
    || string(row.sourceUrl || row.inputUrl).includes("61593471075023")
  )) return "Makeable Facebook";
  return "";
}
function attributionKey(platform, account) {
  return platform === "instagram" && account === "@makeable.build" ? "makeable_build"
    : platform === "instagram" && account === "@makeable.zak" ? "makeable_zak"
      : platform === "facebook" ? "makeable_facebook" : "trymakeable_build";
}
function timestamp(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function string(value) { return typeof value === "string" ? value.trim() : ""; }
function safeUrl(value) { try { const url = new URL(string(value)); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }
