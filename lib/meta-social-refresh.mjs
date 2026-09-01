import { SocialRefreshError } from "./social-refresh-error.mjs";

const FACEBOOK_GRAPH_API = "https://graph.facebook.com/v26.0";
const SOURCE_TIMEOUT_MS = 15_000;
const REPORTING_RANGES = [7, 30, 90];

export async function refreshInstagramRecords({ accessToken, accounts, fetchImpl, now = new Date() }) {
  const result = await Promise.all(accounts.map(async (account) => {
    const accountId = string(account?.id);
    const accountName = string(account?.account);
    const attributionKey = string(account?.attributionKey);
    if (!accountId || !accountName || !attributionKey) throw new SocialRefreshError("instagram", 400, "Instagram account configuration is incomplete.");
    const [accountBody, mediaBody, accountAnalytics] = await Promise.all([
      jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(accountId)}`, {
        access_token: accessToken,
        fields: "followers_count,media_count",
      }), "instagram", fetchImpl),
      jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(accountId)}/media`, {
        access_token: accessToken,
        fields: "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count",
        limit: "12",
      }), "instagram", fetchImpl),
      instagramAccountAnalytics({ accessToken, accountId, fetchImpl, now }),
    ]);
    const records = Array.isArray(mediaBody?.data) ? mediaBody.data : [];
    const enriched = await Promise.all(records.map(async (record) => ({
      ...record,
      insights: await contentInsights({
        accessToken,
        contentId: string(record?.id),
        fetchImpl,
        metrics: "views,reach,shares,saved,total_interactions",
        platform: "instagram",
      }),
    })));
    const followers = number(accountBody?.followers_count);
    return enriched.map((record, index) => normalizeInstagramRecord(record, accountName, attributionKey, followers, index === 0 ? accountAnalytics : null)).filter(Boolean);
  }));
  return requireRecords("instagram", result.flat());
}

export async function refreshFacebookRecords({ accessToken, pageId, fetchImpl, now = new Date() }) {
  const pageBody = await jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(pageId)}`, {
    access_token: accessToken,
    fields: "access_token,followers_count,fan_count",
  }), "facebook", fetchImpl);
  const pageAccessToken = string(pageBody?.access_token) || accessToken;
  const [postsBody, accountAnalytics] = await Promise.all([
    jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(pageId)}/posts`, {
      access_token: pageAccessToken,
      fields: "id,message,created_time,permalink_url,full_picture,attachments{media_type,url},reactions.summary(true),comments.summary(true),shares",
      limit: "12",
    }), "facebook", fetchImpl),
    facebookAccountAnalytics({ accessToken: pageAccessToken, pageId, fetchImpl, now }),
  ]);
  const records = Array.isArray(postsBody?.data) ? postsBody.data : [];
  const enriched = await Promise.all(records.map(async (record) => ({
    ...record,
    insights: await contentInsights({
      accessToken: pageAccessToken,
      contentId: string(record?.id),
      fetchImpl,
      metrics: "post_media_view,post_clicks",
      platform: "facebook",
    }),
  })));
  const followers = number(pageBody?.followers_count) || number(pageBody?.fan_count);
  return requireRecords("facebook", enriched.map((record, index) => normalizeFacebookRecord(record, followers, index === 0 ? accountAnalytics : null)).filter(Boolean));
}

function normalizeInstagramRecord(record, account, attributionKey, followers, accountAnalytics) {
  const permalink = safeUrl(record?.permalink);
  const contentId = instagramContentId(permalink) || string(record?.id);
  const publishedAt = timestamp(record?.timestamp);
  if (!contentId || !publishedAt) return null;
  const totalInteractions = insight(record?.insights, ["total_interactions"]);
  const contentType = string(record?.media_product_type || record?.media_type || "post").toLowerCase();
  const isVideo = contentType === "video" || contentType === "reels" || contentType === "reel";
  return socialRecord({ platform: "instagram", account, contentId, publishedAt, contentType, caption: string(record?.caption), impressions: insight(record?.insights, ["views", "impressions", "reach"]), engagements: totalInteractions || number(record?.like_count) + number(record?.comments_count) + insight(record?.insights, ["shares", "saved"]), followers, accountAnalytics, attributionKey, thumbnailUrl: safeUrl(record?.thumbnail_url || record?.media_url), previewUrl: isVideo ? safeUrl(record?.media_url) : "", postUrl: permalink });
}

function normalizeFacebookRecord(record, followers, accountAnalytics) {
  const contentId = string(record?.id);
  const publishedAt = timestamp(record?.created_time);
  if (!contentId || !publishedAt) return null;
  const attachment = Array.isArray(record?.attachments?.data) ? record.attachments.data[0] : null;
  const contentType = string(attachment?.media_type || "post").toLowerCase();
  const postUrl = safeUrl(record?.permalink_url);
  const isVideo = contentType.includes("video");
  return socialRecord({ platform: "facebook", account: "Makeable Facebook", contentId, publishedAt, contentType, caption: string(record?.message), impressions: insight(record?.insights, ["post_media_view"]), engagements: number(record?.reactions?.summary?.total_count) + number(record?.comments?.summary?.total_count) + number(record?.shares?.count), followers, clicks: insight(record?.insights, ["post_clicks"]), accountAnalytics, attributionKey: "makeable_facebook", thumbnailUrl: safeUrl(record?.full_picture), embedUrl: isVideo && postUrl ? facebookEmbedUrl(postUrl) : "", postUrl });
}

async function instagramAccountAnalytics({ accessToken, accountId, fetchImpl, now }) {
  const entries = await Promise.all(REPORTING_RANGES.map(async (days) => {
    const windows = await Promise.all(reportingWindows(now, days).map(async (range) => {
      const [followsBody, clicksBody] = await Promise.all([
        jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(accountId)}/insights`, {
          access_token: accessToken,
          metric: "follows_and_unfollows",
          metric_type: "total_value",
          breakdown: "follow_type",
          period: "day",
          ...range,
        }), "instagram", fetchImpl),
        jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(accountId)}/insights`, {
          access_token: accessToken,
          metric: "website_clicks",
          metric_type: "total_value",
          period: "day",
          ...range,
        }), "instagram", fetchImpl),
      ]);
      return {
        clicks: totalValue(clicksBody),
        followersGained: breakdownValue(followsBody, "FOLLOWER"),
      };
    }));
    return [days, {
      clicks: windows.reduce((total, window) => total + window.clicks, 0),
      followersGained: windows.reduce((total, window) => total + window.followersGained, 0),
    }];
  }));
  return Object.fromEntries(entries);
}

async function facebookAccountAnalytics({ accessToken, pageId, fetchImpl, now }) {
  const entries = await Promise.all(REPORTING_RANGES.map(async (days) => {
    const body = await jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(pageId)}/insights`, {
      access_token: accessToken,
      metric: "page_daily_follows,page_daily_unfollows",
      period: "day",
      ...reportingRange(now, days),
    }), "facebook", fetchImpl);
    return [days, { followersGained: metricSum(body, "page_daily_follows") }];
  }));
  return Object.fromEntries(entries);
}

async function contentInsights({ accessToken, contentId, fetchImpl, metrics, platform }) {
  if (!contentId) return { data: [] };
  return jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(contentId)}/insights`, {
    access_token: accessToken,
    metric: metrics,
  }), platform, fetchImpl);
}

async function jsonRequest(url, platform, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (response.ok) return response.json();
  throw new SocialRefreshError(platform, response.status, await response.text());
}

function socialRecord({ platform, account, contentId, publishedAt, contentType, caption, impressions, engagements, followers, clicks = null, accountAnalytics = null, attributionKey, thumbnailUrl, previewUrl = "", embedUrl = "", postUrl }) {
  return { id: `${platform}:${account}:${contentId}`, platform, account, publishedAt, contentId, contentType, caption: caption.slice(0, 500), impressions, engagements, followers, followersGained: null, clicks, coverage: "connected", attributionKey, engagementsComplete: true, accountAnalytics, thumbnailUrl, previewUrl, ...(embedUrl ? { embedUrl } : {}), postUrl };
}

function facebookEmbedUrl(postUrl) {
  const url = new URL("https://www.facebook.com/plugins/video.php");
  url.searchParams.set("href", postUrl);
  url.searchParams.set("show_text", "false");
  return url.href;
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
function reportingRange(now, days) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) };
}
function reportingWindows(now, days) {
  const windows = [];
  let until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  let remaining = days;
  while (remaining > 0) {
    const windowDays = Math.min(30, remaining);
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - windowDays);
    windows.push({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) });
    until = since;
    remaining -= windowDays;
  }
  return windows;
}
function totalValue(body) { return number(body?.data?.[0]?.total_value?.value); }
function breakdownValue(body, dimension) {
  const breakdowns = body?.data?.[0]?.total_value?.breakdowns;
  const results = Array.isArray(breakdowns?.[0]?.results) ? breakdowns[0].results : [];
  return number(results.find((result) => result?.dimension_values?.[0] === dimension)?.value);
}
function metricSum(body, name) {
  const metric = Array.isArray(body?.data) ? body.data.find((entry) => entry?.name === name) : null;
  return (Array.isArray(metric?.values) ? metric.values : []).reduce((total, point) => total + number(point?.value), 0);
}
function instagramContentId(permalink) { const match = permalink.match(/\/(?:p|reel)\/([^/?#]+)/); return match ? match[1] : ""; }
function timestamp(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function string(value) { return typeof value === "string" ? value.trim() : ""; }
function safeUrl(value) { try { const url = new URL(string(value)); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }
