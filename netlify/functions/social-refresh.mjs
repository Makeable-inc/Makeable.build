import { getStore } from "@netlify/blobs";
import { refreshApifySocialRecords } from "../../lib/apify-social.mjs";
import { mergeSocialRecords, persistSocialRecords, readSocialRecords, socialStoreNameForFunctionContext } from "../../lib/social-dashboard.mjs";

export const config = { schedule: "0 * * * *" };

export default async function handler(_req, context = {}) {
  try {
    const token = globalThis.Netlify?.env?.get("APIFY_TOKEN") || process.env.APIFY_TOKEN || "";
    const store = getStore({ name: socialStoreNameForFunctionContext(context), consistency: "strong" });
    const { records: incoming, failures } = await refreshApifySocialRecords({ token });
    const records = mergeSocialRecords(await readSocialRecords(store), incoming);
    await persistSocialRecords(store, records);
    return jsonResponse({ imported: incoming.length, total: records.length, partialFailures: failures });
  } catch (error) {
    console.error("Scheduled social refresh failed", error);
    return jsonResponse({ error: "Scheduled social refresh failed." }, 500);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
