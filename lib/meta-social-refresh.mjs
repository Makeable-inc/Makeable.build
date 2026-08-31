import { SocialRefreshError } from "./social-refresh-error.mjs";

const FACEBOOK_GRAPH_API = "https://graph.facebook.com/v26.0";
const SOURCE_TIMEOUT_MS = 15_000;

export async function refreshInstagramRecords({ accessToken, accounts, fetchImpl }) {
  const result = await Promise.all(accounts.map(async (account) => {
    const accountId = string(account?.id);
    const accountName = string(account?.account);
    const attributionKey = string(account?.attributionKey);
    if (!accountId || !accountName || !attributionKey) throw new SocialRefreshError("instagram", 400, "Instagram account configuration is incomplete.");
    const [accountBody, mediaBody] = await Promise.all([
      jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(accountId)}`, {
        access_token: accessToken,
        fields: "followers_count,media_count",
      }), "instagram", fetchImpl),
      jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(accountId)}/media`, {
        access_token: accessToken,
        fields: "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count",
        limit: "12",
      }), "instagram", fetchImpl),
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
    return enriched.map((record) => normalizeInstagramRecord(record, accountName, attributionKey, followers)).filter(Boolean);
  }));
  return requireRecords("instagram", result.flat());
}

export async function refreshFacebookRecords({ accessToken, pageId, fetchImpl }) {
  const pageBody = await jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(pageId)}`, {
    access_token: accessToken,
    fields: "access_token,followers_count,fan_count",
  }), "facebook", fetchImpl);
  const pageAccessToken = string(pageBody?.access_token) || accessToken;
  const postsBody = await jsonRequest(queryUrl(`${FACEBOOK_GRAPH_API}/${encodeURIComponent(pageId)}/posts`, {
    access_token: pageAccessToken,
    fields: "id,message,created_time,permalink_url,full_picture,reactions.summary(true),comments.summary(true),shares",
    limit: "12",
  }), "facebook", fetchImpl);
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
  return requireRecords("facebook", enriched.map((record) => normalizeFacebookRecord(record, followers)).filter(Boolean));
}

function normalizeInstagramRecord(record, account, attributionKey, followers) {
  const permalink = safeUrl(record?.permalink);
  const contentId = instagramContentId(permalink) || string(record?.id);
  const publishedAt = timestamp(record?.timestamp);
  if (!contentId || !publishedAt) return null;
  const totalInteractions = insight(record?.insights, ["total_interactions"]);
  return socialRecord({ platform: "instagram", account, contentId, publishedAt, contentType: string(record?.media_product_type || record?.media_type || "post").toLowerCase(), caption: string(record?.caption), impressions: insight(record?.insights, ["views", "impressions", "reach"]), engagements: totalInteractions || number(record?.like_count) + number(record?.comments_count) + insight(record?.insights, ["shares", "saved"]), followers, attributionKey, thumbnailUrl: safeUrl(record?.thumbnail_url || record?.media_url), postUrl: permalink });
}

function normalizeFacebookRecord(record, followers) {
  const contentId = string(record?.id);
  const publishedAt = timestamp(record?.created_time);
  if (!contentId || !publishedAt) return null;
  return socialRecord({ platform: "facebook", account: "Makeable Facebook", contentId, publishedAt, contentType: "post", caption: string(record?.message), impressions: insight(record?.insights, ["post_media_view"]), engagements: number(record?.reactions?.summary?.total_count) + number(record?.comments?.summary?.total_count) + number(record?.shares?.count), followers, clicks: insight(record?.insights, ["post_clicks"]), attributionKey: "makeable_facebook", thumbnailUrl: safeUrl(record?.full_picture), postUrl: safeUrl(record?.permalink_url) });
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

function socialRecord({ platform, account, contentId, publishedAt, contentType, caption, impressions, engagements, followers, clicks = null, attributionKey, thumbnailUrl, postUrl }) {
  return { id: `${platform}:${account}:${contentId}`, platform, account, publishedAt, contentId, contentType, caption: caption.slice(0, 500), impressions, engagements, followers, followersGained: null, clicks, coverage: "connected", attributionKey, engagementsComplete: true, thumbnailUrl, previewUrl: "", postUrl };
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
function timestamp(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ""; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function string(value) { return typeof value === "string" ? value.trim() : ""; }
function safeUrl(value) { try { const url = new URL(string(value)); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }
