const RANK_FIELDS = new Set([
  "impressions",
  "engagements",
  "engagementRate",
  "followersGained",
  "websiteSessions",
  "websiteVisitRate",
  "posts",
]);
const COVERAGE_STATES = new Set([
  "connected",
  "platform-only",
  "public-snapshot",
  "attribution-only",
  "unavailable",
]);
const ATTRIBUTION_KEY_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function buildSocialView(records, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const days = options.days === "all" ? "all" : Number(options.days) || 30;
  const rankBy = RANK_FIELDS.has(options.rankBy) ? options.rankBy : "impressions";
  const filtered = rangeRecords(Array.isArray(records) ? records : [], days, now);
  const totalImpressions = sum(filtered, "impressions");
  const totalEngagements = sum(filtered, "engagements");
  const complete = filtered.filter((record) => record.engagementsComplete !== false);
  const completeExposures = sum(complete, "impressions");
  const attributionConnected = options.attribution?.status === "connected";
  const sessions = attributionSessions(options.attribution, days, now);
  const accounts = accountRows(filtered, attributionConnected, sessions).sort((left, right) =>
    rankValue(right, rankBy) - rankValue(left, rankBy)
    || right.impressions - left.impressions
    || left.account.localeCompare(right.account)
    || left.platform.localeCompare(right.platform)
    || left.attributionKey.localeCompare(right.attributionKey),
  );
  accounts.forEach((account, index) => {
    account.rank = index + 1;
  });
  const websiteSessions = attributionConnected
    ? accounts.reduce((total, account) => total + account.websiteSessions, 0)
    : null;
  return {
    rankBy,
    attributionStatus: attributionConnected
      ? "connected"
      : options.attribution?.status === "unavailable"
        ? "unavailable"
        : "not_connected",
    totalImpressions,
    totalExposures: totalImpressions,
    totalEngagements,
    engagementRate: completeExposures
      ? sum(complete, "engagements") / completeExposures
      : null,
    websiteSessions,
    websiteVisitRate: websiteSessions !== null && totalImpressions
      ? websiteSessions / totalImpressions
      : null,
    followersGained: optionalSum(filtered, "followersGained"),
    totalClicks: optionalSum(filtered, "clicks"),
    postsTotal: filtered.length,
    accounts,
    daily: dailyRows(filtered, days, now),
    content: [...filtered].sort((left, right) =>
      right.impressions - left.impressions
      || right.engagements - left.engagements
      || right.publishedAt.localeCompare(left.publishedAt),
    ),
  };
}

export function mediaKind(record) {
  if (record?.previewUrl) return "video";
  if (record?.thumbnailUrl) return "image";
  return "unavailable";
}

function rangeRecords(records, days, now) {
  return records.filter((record) => inRange(record.publishedAt, days, now));
}

function inRange(value, days, now) {
  if (days === "all") return true;
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (Math.max(1, days) - 1) * 86_400_000;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    && timestamp >= start
    && timestamp <= end + 86_399_999;
}

function accountRows(records, attributionConnected, sessions) {
  const accounts = new Map();
  records.forEach((record) => {
    const platform = String(record.platform || "").trim().toLowerCase();
    const normalizedAttributionKey = attributionKey(record.attributionKey, record.account);
    const key = `${platform}:${normalizedAttributionKey}`;
    const account = accounts.get(key) || {
      rank: 0,
      platform,
      account: record.account,
      coverage: coverage(record.coverage),
      attributionKey: normalizedAttributionKey,
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
    account.impressions += number(record.impressions);
    account.engagements += number(record.engagements);
    if (record.engagementsComplete !== false) {
      account.completeExposures += number(record.impressions);
      account.completeEngagements += number(record.engagements);
    }
    account.followersGained = optionalAdd(
      account.followersGained,
      optionalNumber(record.followersGained),
    );
    account.clicks = optionalAdd(account.clicks, optionalNumber(record.clicks));
    account.posts += 1;
    if (record.publishedAt >= account.latestPublishedAt) {
      account.latestPublishedAt = record.publishedAt;
      account.account = record.account;
      account.followers = number(record.followers);
      account.coverage = coverage(record.coverage);
    }
    accounts.set(key, account);
  });
  return [...accounts.values()].map((account) => {
    const {
      completeExposures,
      completeEngagements,
      ...summary
    } = account;
    const websiteSessions = attributionConnected
      ? sessions.get(`${account.platform}:${account.attributionKey}`) || 0
      : null;
    return {
      ...summary,
      engagementRate: completeExposures
        ? completeEngagements / completeExposures
        : null,
      websiteSessions,
      websiteVisitRate: websiteSessions !== null && account.impressions
        ? websiteSessions / account.impressions
        : null,
    };
  });
}

function attributionSessions(attribution, days, now) {
  const sessions = new Map();
  if (attribution?.status !== "connected" || !Array.isArray(attribution.daily)) {
    return sessions;
  }
  attribution.daily
    .filter((row) => inRange(`${row.date}T00:00:00.000Z`, days, now))
    .forEach((row) => {
      const key = `${row.platform}:${row.accountKey}`;
      sessions.set(key, (sessions.get(key) || 0) + number(row.websiteSessions));
    });
  return sessions;
}

function dailyRows(records, days, now) {
  const points = new Map();
  records.forEach((record) => {
    const date = record.publishedAt.slice(0, 10);
    const point = points.get(date) || {
      date,
      impressions: 0,
      engagements: 0,
      completeExposures: 0,
      completeEngagements: 0,
      clicks: 0,
      posts: 0,
    };
    point.impressions += number(record.impressions);
    point.engagements += number(record.engagements);
    if (record.engagementsComplete !== false) {
      point.completeExposures += number(record.impressions);
      point.completeEngagements += number(record.engagements);
    }
    point.clicks = optionalAdd(point.clicks, optionalNumber(record.clicks));
    point.posts += 1;
    points.set(date, point);
  });
  if (days === "all") {
    return [...points.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map(dailyPoint);
  }
  const output = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - (Math.max(1, days) - 1) * 86_400_000;
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    output.push(points.get(date) || {
      date,
      impressions: 0,
      engagements: 0,
      completeExposures: 0,
      completeEngagements: 0,
      clicks: 0,
      posts: 0,
    });
  }
  return output.map(dailyPoint);
}

function dailyPoint(point) {
  const {
    completeExposures,
    completeEngagements,
    ...summary
  } = point;
  return {
    ...summary,
    engagementRate: completeExposures
      ? completeEngagements / completeExposures
      : null,
  };
}

function sum(records, key) {
  return records.reduce((total, record) => total + number(record[key]), 0);
}

function optionalSum(records, key) {
  return records.reduce(
    (total, record) => optionalAdd(total, optionalNumber(record[key])),
    0,
  );
}

function optionalAdd(total, value) {
  return total === null || value === null ? null : total + value;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function coverage(value) {
  return COVERAGE_STATES.has(value) ? value : "platform-only";
}

function attributionKey(value, account) {
  if (typeof value === "string" && ATTRIBUTION_KEY_PATTERN.test(value)) return value;
  return String(account || "")
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function rankValue(account, key) {
  return Number.isFinite(account[key]) ? account[key] : -1;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
