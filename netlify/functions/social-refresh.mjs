import { getStore } from "@netlify/blobs";
import { refreshSocialRecords } from "../../lib/social-refresh.mjs";
import { persistSocialRecords, readSocialRecords, reconcileRefreshedSocialRecords, socialStoreNameForFunctionContext } from "../../lib/social-dashboard.mjs";
import { loadTikTokAccessToken } from "../../lib/tiktok-oauth.mjs";
import { loadYouTubeAccessToken } from "../../lib/youtube-oauth.mjs";

export const config = { schedule: "*/15 * * * *" };

export default async function handler(_req, context = {}) {
  try {
    const metaAccessToken = value("META_ACCESS_TOKEN");
    const youtubeApiKey = globalThis.Netlify?.env?.get("YOUTUBE_API_KEY") || process.env.YOUTUBE_API_KEY || "";
    const store = getStore({ name: socialStoreNameForFunctionContext(context), consistency: "strong" });
    const tiktokAccessToken = await resolvedTikTokAccessToken(store);
    const youtubeAccessToken = await resolvedYouTubeAccessToken(store);
    const { records: incoming, failures, refreshedPlatforms } = await refreshSocialRecords({
      youtubeApiKey,
      youtubeAccessToken,
      metaAccessToken,
      instagramAccounts: [
        { id: value("INSTAGRAM_MAKEABLE_BUILD_ID"), account: "@makeable.build", attributionKey: "makeable_build" },
        { id: value("INSTAGRAM_MAKEABLE_ZAK_ID"), account: "@makeable.zak", attributionKey: "makeable_zak" },
      ].filter((account) => account.id),
      tiktokAccessToken,
      facebookPageId: value("FACEBOOK_PAGE_ID"),
    });
    const records = reconcileRefreshedSocialRecords(
      await readSocialRecords(store),
      incoming,
      refreshedPlatforms,
      failures.map(({ platform }) => platform),
    );
    await persistSocialRecords(store, records);
    return jsonResponse({ imported: incoming.length, total: records.length, partialFailures: failures, refreshedPlatforms });
  } catch (error) {
    console.error("Scheduled social refresh failed", error);
    return jsonResponse({ error: "Scheduled social refresh failed." }, 500);
  }
}

async function resolvedYouTubeAccessToken(store) {
  try {
    return await loadYouTubeAccessToken({
      store,
      clientId: value("YOUTUBE_OAUTH_CLIENT_ID"),
      clientSecret: value("YOUTUBE_OAUTH_CLIENT_SECRET"),
      fallbackToken: value("YOUTUBE_ACCESS_TOKEN"),
      fetchImpl: fetch,
    });
  } catch (error) {
    console.warn("Scheduled YouTube token refresh failed", error instanceof Error ? error.message : "Unknown error");
    return value("YOUTUBE_ACCESS_TOKEN");
  }
}

async function resolvedTikTokAccessToken(store) {
  try {
    return await loadTikTokAccessToken({
      store,
      clientKey: value("TIKTOK_CLIENT_KEY"),
      clientSecret: value("TIKTOK_CLIENT_SECRET"),
      fallbackToken: value("TIKTOK_ACCESS_TOKEN"),
      fetchImpl: fetch,
    });
  } catch (error) {
    console.warn("Scheduled TikTok token refresh failed", error instanceof Error ? error.message : "Unknown error");
    return value("TIKTOK_ACCESS_TOKEN");
  }
}

function value(key) {
  return globalThis.Netlify?.env?.get(key) || process.env[key] || "";
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
