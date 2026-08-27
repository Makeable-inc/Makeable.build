const POSTHOG_QUERY_URL = "https://us.posthog.com/api/projects";
const PROJECT_ID_PATTERN = /^\d+$/;
const ACCOUNT_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SOCIAL_PLATFORMS = new Set([
  "instagram",
  "tiktok",
  "youtube",
  "linkedin",
  "x",
]);

const SOCIAL_WEBSITE_SESSIONS_QUERY = `
  SELECT
    toString(toDate(timestamp)) AS date,
    properties['social_platform'] AS platform,
    properties['social_account'] AS accountKey,
    uniqExact(properties['$session_id']) AS websiteSessions
  FROM events
  WHERE event = 'social_landing_view'
    AND properties['social_platform'] != ''
    AND properties['social_account'] != ''
  GROUP BY date, platform, accountKey
  ORDER BY date ASC, platform ASC, accountKey ASC
`;

const NOT_CONNECTED = Object.freeze({ status: "not_connected", daily: [] });
const UNAVAILABLE = Object.freeze({ status: "unavailable", daily: [] });

export async function readSocialWebsiteSessions(options = {}) {
  const personalApiKey = typeof options.personalApiKey === "string"
    ? options.personalApiKey.trim()
    : "";
  const projectId = typeof options.projectId === "string"
    ? options.projectId.trim()
    : "";

  if (!personalApiKey || !projectId) return NOT_CONNECTED;
  if (!PROJECT_ID_PATTERN.test(projectId) || typeof options.fetchImpl !== "function") {
    return UNAVAILABLE;
  }

  try {
    const response = await options.fetchImpl(`${POSTHOG_QUERY_URL}/${projectId}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${personalApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          kind: "HogQLQuery",
          query: SOCIAL_WEBSITE_SESSIONS_QUERY,
        },
      }),
    });
    if (!response || response.ok !== true || typeof response.json !== "function") {
      return UNAVAILABLE;
    }
    const payload = await response.json();
    const daily = normalizeRows(payload);
    return daily ? { status: "connected", daily } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

function normalizeRows(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (!Array.isArray(payload.results)) return null;

  const daily = [];
  for (const row of payload.results) {
    if (!Array.isArray(row) || row.length !== 4) return null;
    const [date, platform, accountKey, websiteSessions] = row;
    if (
      !validDate(date)
      || typeof platform !== "string"
      || !SOCIAL_PLATFORMS.has(platform)
      || typeof accountKey !== "string"
      || !ACCOUNT_KEY_PATTERN.test(accountKey)
      || !Number.isSafeInteger(websiteSessions)
      || websiteSessions < 0
    ) {
      return null;
    }
    daily.push({ date, platform, accountKey, websiteSessions });
  }
  return daily;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
