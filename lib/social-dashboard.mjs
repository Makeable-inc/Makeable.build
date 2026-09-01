import { SOCIAL_DASHBOARD_SEED } from "./social-dashboard-seed.mjs";

const SOCIAL_STORE_NAME = "makeable-social-analytics";
const SOCIAL_DATA_KEY = "v1/social-records.json";
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5_000;
const PLATFORMS = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "x",
  "youtube",
]);
const COVERAGE_STATES = new Set([
  "connected",
  "platform-only",
  "public-snapshot",
  "attribution-only",
  "unavailable",
]);
const ATTRIBUTION_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const REQUIRED_HEADERS = [
  "platform",
  "account",
  "published_at",
  "content_id",
  "content_type",
  "caption",
  "impressions",
  "engagements",
  "followers_current",
  "followers_gained",
  "clicks",
  "thumbnail_url",
  "preview_url",
  "post_url",
];

export function socialStoreNameForFunctionContext(context = {}) {
  const deployContext =
    typeof context?.deploy?.context === "string" ? context.deploy.context : "";
  return deployContext && deployContext !== "production"
    ? `${SOCIAL_STORE_NAME}-preview`
    : SOCIAL_STORE_NAME;
}

export function parseSocialCsv(csv) {
  if (typeof csv !== "string" || !csv.trim()) {
    throw new Error("Choose a non-empty CSV file.");
  }
  if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) {
    throw new Error("The social CSV must be 2 MB or smaller.");
  }
  const rows = csvRows(csv);
  if (rows.length < 2) throw new Error("The social CSV has no content rows.");
  if (rows.length - 1 > MAX_ROWS) {
    throw new Error(`The social CSV may contain at most ${MAX_ROWS} rows.`);
  }
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new Error(`The social CSV is missing: ${missing.join(", ")}.`);
  }
  const indexes = new Map(headers.map((header, index) => [header, index]));
  const records = new Map();
  rows.slice(1).forEach((values, index) => {
    if (values.every((value) => !value.trim())) return;
    const rowNumber = index + 2;
    const value = (header) => values[indexes.get(header)]?.trim() || "";
    const platform = value("platform").toLowerCase();
    if (!PLATFORMS.has(platform)) {
      throw new Error(`Row ${rowNumber} has an unsupported platform.`);
    }
    const account = boundedText(value("account"), 80);
    const contentId = boundedText(value("content_id"), 160);
    if (!account) throw new Error(`Row ${rowNumber} needs an account.`);
    if (!contentId) throw new Error(`Row ${rowNumber} needs a content_id.`);
    const publishedAt = timestamp(value("published_at"));
    if (!publishedAt) throw new Error(`Row ${rowNumber} has an invalid published_at.`);
    const record = {
      id: `${platform}:${account}:${contentId}`,
      platform,
      account,
      publishedAt,
      contentId,
      contentType: boundedText(value("content_type"), 40) || "post",
      caption: boundedText(value("caption"), 500),
      impressions: metric(value("impressions"), "impressions", rowNumber),
      engagements: metric(value("engagements"), "engagements", rowNumber),
      followers: metric(value("followers_current"), "followers_current", rowNumber),
      followersGained: optionalMetric(
        value("followers_gained"),
        "followers_gained",
        rowNumber,
      ),
      clicks: optionalMetric(value("clicks"), "clicks", rowNumber),
      coverage: COVERAGE_STATES.has(value("coverage").toLowerCase())
        ? value("coverage").toLowerCase()
        : "platform-only",
      attributionKey: attributionKey(value("attribution_key"), account),
      engagementsComplete: value("engagements_complete").toLowerCase() !== "false",
      thumbnailUrl: safeUrl(value("thumbnail_url"), "thumbnail_url", rowNumber),
      previewUrl: safeUrl(value("preview_url"), "preview_url", rowNumber),
      postUrl: safeUrl(value("post_url"), "post_url", rowNumber),
    };
    records.set(record.id, record);
  });
  if (!records.size) throw new Error("The social CSV has no valid content rows.");
  return [...records.values()].sort(recordSort);
}

export function mergeSocialRecords(existing, incoming) {
  const records = new Map();
  [...existing, ...incoming].forEach((record) => {
    const normalized = normalizeRecord(record);
    if (normalized) records.set(normalized.id, normalized);
  });
  return [...records.values()].sort(recordSort);
}

export function reconcileRefreshedSocialRecords(existing, incoming, refreshedPlatforms) {
  const refreshed = new Set(
    (Array.isArray(refreshedPlatforms) ? refreshedPlatforms : [])
      .map((platform) => boundedText(platform, 20).toLowerCase())
      .filter((platform) => PLATFORMS.has(platform)),
  );
  const retained = (Array.isArray(existing) ? existing : [])
    .filter((record) => !refreshed.has(boundedText(record?.platform, 20).toLowerCase()));
  return mergeSocialRecords(retained, incoming);
}

export function buildSocialDashboardReport(records, options = {}) {
  const generatedAt = timestamp(
    options.now instanceof Date
      ? options.now.toISOString()
      : String(options.now || new Date().toISOString()),
  );
  if (!generatedAt) throw new Error("A valid dashboard timestamp is required.");
  const normalized = mergeSocialRecords([], records);
  const totals = summarize(normalized);
  const accounts = accountSummary(normalized).sort(accountSort);
  accounts.forEach((account, index) => {
    account.rank = index + 1;
  });
  return {
    generatedAt,
    ...totals,
    attribution: normalizeAttribution(options.attribution),
    accounts,
    daily: dailySummary(normalized),
    content: [...normalized].sort(contentSort),
    records: normalized,
  };
}

export async function readSocialRecords(store) {
  const stored = await store.get(SOCIAL_DATA_KEY, {
    type: "json",
    consistency: "strong",
  });
  const records = Array.isArray(stored?.records) ? stored.records : [];
  return stored?.schemaVersion >= 2
    ? mergeSocialRecords([], records)
    : mergeSocialRecords(SOCIAL_DASHBOARD_SEED, records);
}

export async function persistSocialRecords(store, records, options = {}) {
  const updatedAt = timestamp(
    options.now instanceof Date
      ? options.now.toISOString()
      : String(options.now || new Date().toISOString()),
  );
  if (!updatedAt) throw new Error("A valid import timestamp is required.");
  const normalized = mergeSocialRecords([], records);
  await store.setJSON(SOCIAL_DATA_KEY, {
    schemaVersion: 2,
    updatedAt,
    records: normalized,
  });
  return normalized;
}

export async function dashboardSocialResult(request, options) {
  if (request.method === "GET") {
    const records = await readSocialRecords(options.store);
    return {
      status: 200,
      body: buildSocialDashboardReport(records, {
        now: options.now,
        attribution: options.attribution,
      }),
    };
  }
  if (request.method !== "POST") {
    return {
      status: 405,
      headers: { Allow: "GET, POST" },
      body: { error: "Method not allowed" },
    };
  }
  const body = request.body;
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || typeof body.csv !== "string"
    || Object.keys(body).some((key) => key !== "csv")
  ) {
    return {
      status: 400,
      body: { error: "Upload one valid social CSV file." },
    };
  }
  try {
    const imported = parseSocialCsv(body.csv);
    const existing = await readSocialRecords(options.store);
    const records = mergeSocialRecords(existing, imported);
    await persistSocialRecords(options.store, records, { now: options.now });
    return {
      status: 200,
      body: {
        imported: imported.length,
        total: records.length,
        report: buildSocialDashboardReport(records, {
          now: options.now,
          attribution: options.attribution,
        }),
      },
    };
  } catch (error) {
    return {
      status: 400,
      body: {
        error: error instanceof Error ? error.message : "The social CSV is invalid.",
      },
    };
  }
}

function normalizeAttribution(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !new Set(["connected", "not_connected", "unavailable"]).has(value.status)
    || !Array.isArray(value.daily)
  ) {
    return { status: "not_connected", daily: [] };
  }
  return {
    status: value.status,
    daily: value.status === "connected" ? structuredClone(value.daily) : [],
  };
}

function csvRows(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("The social CSV contains an unclosed quoted field.");
  row.push(field);
  if (row.some((value) => value.length)) rows.push(row);
  return rows;
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const platform = boundedText(value.platform, 20).toLowerCase();
  const account = boundedText(value.account, 80);
  const contentId = boundedText(value.contentId, 160);
  const publishedAt = timestamp(value.publishedAt);
  if (!PLATFORMS.has(platform) || !account || !contentId || !publishedAt) return null;
  const embedUrl = storedUrl(value.embedUrl);
  return {
    id: `${platform}:${account}:${contentId}`,
    platform,
    account,
    publishedAt,
    contentId,
    contentType: boundedText(value.contentType, 40) || "post",
    caption: boundedText(value.caption, 500),
    impressions: storedMetric(value.impressions),
    engagements: storedMetric(value.engagements),
    followers: storedMetric(value.followers),
    followersGained: optionalStoredMetric(value.followersGained),
    clicks: optionalStoredMetric(value.clicks),
    accountAnalytics: normalizeAccountAnalytics(value.accountAnalytics),
    coverage: COVERAGE_STATES.has(value.coverage)
      ? value.coverage
      : "platform-only",
    attributionKey: attributionKey(value.attributionKey, account),
    engagementsComplete: value.engagementsComplete !== false,
    analytics: normalizeAnalytics(value.analytics),
    thumbnailUrl: storedUrl(value.thumbnailUrl),
    previewUrl: storedUrl(value.previewUrl),
    ...(embedUrl ? { embedUrl } : {}),
    postUrl: storedUrl(value.postUrl),
  };
}

function normalizeAnalytics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    estimatedMinutesWatched: storedMetric(value.estimatedMinutesWatched),
    averageViewDuration: storedMetric(value.averageViewDuration),
    averageViewPercentage: storedMetric(value.averageViewPercentage),
  };
}

function normalizeAccountAnalytics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {};
  [7, 30, 90].forEach((days) => {
    const entry = value[days];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const clicks = optionalStoredMetric(entry.clicks);
    const followersGained = optionalStoredMetric(entry.followersGained);
    if (clicks === null && followersGained === null) return;
    normalized[days] = {
      ...(clicks === null ? {} : { clicks }),
      ...(followersGained === null ? {} : { followersGained }),
    };
  });
  return Object.keys(normalized).length ? normalized : null;
}

function summarize(records) {
  const totalImpressions = sum(records, "impressions");
  const totalEngagements = sum(records, "engagements");
  const complete = records.filter((record) => record.engagementsComplete);
  const completeExposures = sum(complete, "impressions");
  return {
    totalImpressions,
    totalExposures: totalImpressions,
    totalEngagements,
    engagementRate: completeExposures
      ? sum(complete, "engagements") / completeExposures
      : null,
    followersGained: optionalSum(records, "followersGained"),
    totalClicks: optionalSum(records, "clicks"),
    postsTotal: records.length,
  };
}

function accountSummary(records) {
  const accounts = new Map();
  records.forEach((record) => {
    const key = `${record.platform}:${record.account}`;
    const account = accounts.get(key) || {
      platform: record.platform,
      account: record.account,
      coverage: record.coverage,
      attributionKey: record.attributionKey,
      impressions: 0,
      engagements: 0,
      completeExposures: 0,
      completeEngagements: 0,
      followers: 0,
      followersGained: 0,
      clicks: 0,
      posts: 0,
      latestPublishedAt: "",
    };
    account.impressions += record.impressions;
    account.engagements += record.engagements;
    if (record.engagementsComplete) {
      account.completeExposures += record.impressions;
      account.completeEngagements += record.engagements;
    }
    account.followersGained = optionalAdd(account.followersGained, record.followersGained);
    account.clicks = optionalAdd(account.clicks, record.clicks);
    account.posts += 1;
    if (record.publishedAt >= account.latestPublishedAt) {
      account.latestPublishedAt = record.publishedAt;
      account.followers = record.followers;
      account.coverage = record.coverage;
      account.attributionKey = record.attributionKey;
    }
    accounts.set(key, account);
  });
  return [...accounts.values()].map((account) => {
    const {
      completeExposures,
      completeEngagements,
      ...summary
    } = account;
    return {
      ...summary,
      engagementRate: completeExposures
        ? completeEngagements / completeExposures
        : null,
    };
  });
}

function dailySummary(records) {
  const daily = new Map();
  records.forEach((record) => {
    const date = record.publishedAt.slice(0, 10);
    const point = daily.get(date) || {
      date,
      impressions: 0,
      engagements: 0,
      clicks: 0,
      posts: 0,
    };
    point.impressions += record.impressions;
    point.engagements += record.engagements;
    point.clicks = optionalAdd(point.clicks, record.clicks);
    point.posts += 1;
    daily.set(date, point);
  });
  return [...daily.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function metric(value, name, rowNumber) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Row ${rowNumber} has an invalid ${name}.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Row ${rowNumber} has an invalid ${name}.`);
  }
  return number;
}

function optionalMetric(value, name, rowNumber) {
  return value === "" ? null : metric(value, name, rowNumber);
}

function safeUrl(value, name, rowNumber) {
  if (!value) return "";
  const normalized = storedUrl(value);
  if (!normalized) throw new Error(`Row ${rowNumber} has an invalid ${name}.`);
  return normalized;
}

function storedUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2_048) return "";
  try {
    const url = new URL(value, "https://makeable.build");
    if (
      value.startsWith("/")
      && url.origin === "https://makeable.build"
      && url.pathname.startsWith("/dashboard/media/social/")
    ) {
      return `${url.pathname}${url.search}`;
    }
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function storedMetric(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function optionalStoredMetric(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function attributionKey(value, account) {
  if (
    typeof value === "string"
    && value.length <= 80
    && ATTRIBUTION_KEY_PATTERN.test(value)
  ) {
    return value;
  }
  return account
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function timestamp(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function boundedText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function sum(records, key) {
  return records.reduce((total, record) => total + record[key], 0);
}

function optionalSum(records, key) {
  return records.reduce(
    (total, record) => optionalAdd(total, record[key]),
    0,
  );
}

function optionalAdd(total, value) {
  return total === null || value === null ? null : total + value;
}

function recordSort(left, right) {
  return right.publishedAt.localeCompare(left.publishedAt) || left.id.localeCompare(right.id);
}

function contentSort(left, right) {
  return right.impressions - left.impressions || recordSort(left, right);
}

function accountSort(left, right) {
  return right.impressions - left.impressions
    || right.engagements - left.engagements
    || left.account.localeCompare(right.account);
}
