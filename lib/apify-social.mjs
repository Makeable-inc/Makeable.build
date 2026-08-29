const APIFY_API = "https://api.apify.com/v2/acts";

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
]);

export async function refreshApifySocialRecords({ token, fetchImpl = fetch }) {
  if (!token) throw new Error("Apify is not configured for this dashboard.");
  const results = await Promise.all(ACCOUNTS.map(async (source) => {
    const response = await fetchImpl(
      `${APIFY_API}/${source.actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&clean=true`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(source.input) },
    );
    if (!response.ok) throw new Error(`Apify ${source.platform} refresh failed (${response.status}).`);
    const rows = await response.json();
    return Array.isArray(rows) ? rows.map((row) => normalizeRecord(source.platform, row)).filter(Boolean) : [];
  }));
  return results.flat().sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

function normalizeRecord(platform, row) {
  const account = accountFor(platform, row);
  const contentId = string(platform === "instagram" ? row.shortCode || row.id : row.id || row.videoId);
  const publishedAt = timestamp(platform === "instagram" ? row.timestamp : row.createTimeISO || row.createTime);
  if (!account || !contentId || !publishedAt) return null;
  const impressions = number(platform === "instagram" ? row.videoPlayCount || row.videoViewCount : row.playCount);
  const engagements = number(platform === "instagram"
    ? number(row.likesCount) + number(row.commentsCount)
    : number(row.diggCount) + number(row.commentCount) + number(row.shareCount));
  return {
    id: `${platform}:${account}:${contentId}`, platform, account, publishedAt, contentId,
    contentType: platform === "instagram" ? string(row.productType || row.type || "post") : "video",
    caption: string(platform === "instagram" ? row.caption : row.text).slice(0, 500),
    impressions, engagements, followers: number(platform === "instagram" ? row.ownerFollowersCount : row.authorMeta?.fans),
    followersGained: null, clicks: null, coverage: "public-snapshot", attributionKey: attributionKey(platform, account),
    engagementsComplete: false,
    thumbnailUrl: safeUrl(platform === "instagram" ? row.displayUrl : row.videoMeta?.coverUrl),
    previewUrl: safeUrl(platform === "instagram" ? row.videoUrl : row.videoMeta?.downloadAddr),
    postUrl: safeUrl(platform === "instagram" ? row.url : row.webVideoUrl),
  };
}

function accountFor(platform, row) {
  const value = string(platform === "instagram" ? row.ownerUsername : row.authorMeta?.name).replace(/^@/, "");
  if (platform === "instagram" && ["makeable.build", "makeable.zak"].includes(value)) return `@${value}`;
  if (platform === "tiktok" && value === "trymakeable.build") return `@${value}`;
  return "";
}
function attributionKey(platform, account) {
  return platform === "instagram" && account === "@makeable.build" ? "makeable_build"
    : platform === "instagram" && account === "@makeable.zak" ? "makeable_zak" : "trymakeable_build";
}
function timestamp(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function string(value) { return typeof value === "string" ? value.trim() : ""; }
function safeUrl(value) { try { const url = new URL(string(value)); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }
