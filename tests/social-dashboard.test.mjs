import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSocialDashboardReport,
  dashboardSocialResult,
  mergeSocialRecords,
  parseSocialCsv,
  readSocialRecords,
  reconcileRefreshedSocialRecords,
} from "../lib/social-dashboard.mjs";

const now = new Date("2026-08-26T18:00:00.000Z");

test("parseSocialCsv creates safe normalized post records from a quoted CSV export", () => {
  // Given: a normalized export with quoted caption text and remote preview media.
  const csv = [
    "platform,account,published_at,content_id,content_type,caption,impressions,engagements,followers_current,followers_gained,clicks,thumbnail_url,preview_url,post_url",
    'Instagram,@makeable.build,2026-08-25,reel-1,reel,"Desk build, part one",1250,95,842,14,36,https://cdn.example.com/thumb.jpg,https://cdn.example.com/preview.mp4,https://instagram.com/p/reel-1',
  ].join("\n");

  // When: the CSV crosses the import boundary.
  const records = parseSocialCsv(csv);

  // Then: values are normalized into the dashboard record contract.
  assert.deepEqual(records, [{
    id: "instagram:@makeable.build:reel-1",
    platform: "instagram",
    account: "@makeable.build",
    publishedAt: "2026-08-25T00:00:00.000Z",
    contentId: "reel-1",
    contentType: "reel",
    caption: "Desk build, part one",
    impressions: 1250,
    engagements: 95,
    followers: 842,
    followersGained: 14,
    clicks: 36,
    coverage: "platform-only",
    attributionKey: "makeable_build",
    engagementsComplete: true,
    thumbnailUrl: "https://cdn.example.com/thumb.jpg",
    previewUrl: "https://cdn.example.com/preview.mp4",
    postUrl: "https://instagram.com/p/reel-1",
  }]);
});

test("parseSocialCsv preserves unknown optional metrics and parses incomplete engagements", () => {
  // Given: a public snapshot whose private metrics are blank and completeness is CSV text.
  const csv = [
    "platform,account,published_at,content_id,content_type,caption,impressions,engagements,followers_current,followers_gained,clicks,thumbnail_url,preview_url,post_url,coverage,attribution_key,engagements_complete",
    "instagram,@makeable.zak,2026-08-26,reel-1,reel,Public reel,500,15,47,,,,,,public-snapshot,makeable_zak,false",
  ].join("\n");

  // When: the CSV crosses the import boundary.
  const [record] = parseSocialCsv(csv);

  // Then: unknown values stay unknown and the literal false controls completeness.
  assert.equal(record.followersGained, null);
  assert.equal(record.clicks, null);
  assert.equal(record.coverage, "public-snapshot");
  assert.equal(record.attributionKey, "makeable_zak");
  assert.equal(record.engagementsComplete, false);
});

test("parseSocialCsv rejects unsafe media URLs before they reach the dashboard", () => {
  // Given: an otherwise valid row that attempts to use an executable URL.
  const csv = [
    "platform,account,published_at,content_id,content_type,caption,impressions,engagements,followers_current,followers_gained,clicks,thumbnail_url,preview_url,post_url",
    "tiktok,@makeable,2026-08-25,video-1,video,Build clip,500,20,120,2,8,,javascript:alert(1),",
  ].join("\n");

  // When/Then: the import fails at the boundary with the row location.
  assert.throws(
    () => parseSocialCsv(csv),
    /Row 2 has an invalid preview_url/,
  );
});

test("parseSocialCsv keeps same-site dashboard media paths", () => {
  const csv = [
    "platform,account,published_at,content_id,content_type,caption,impressions,engagements,followers_current,followers_gained,clicks,thumbnail_url,preview_url,post_url",
    "instagram,@makeable.build,2026-08-26,reel-1,reel,Real reel,1824,60,14,5,0,/dashboard/media/social/reel-1.jpg,/dashboard/media/social/reel-1.mp4,https://instagram.com/reel-1",
  ].join("\n");

  const [record] = parseSocialCsv(csv);

  assert.equal(record.thumbnailUrl, "/dashboard/media/social/reel-1.jpg");
  assert.equal(record.previewUrl, "/dashboard/media/social/reel-1.mp4");
});

test("buildSocialDashboardReport ranks accounts and preserves the latest follower count", () => {
  // Given: posts across two accounts, including a newer follower snapshot.
  const records = [
    socialRecord({
      id: "instagram:@makeable.build:reel-1",
      platform: "instagram",
      account: "@makeable.build",
      publishedAt: "2026-08-20T00:00:00.000Z",
      impressions: 1200,
      engagements: 96,
      followers: 800,
      followersGained: 10,
      clicks: 32,
    }),
    socialRecord({
      id: "instagram:@makeable.build:reel-2",
      contentId: "reel-2",
      platform: "instagram",
      account: "@makeable.build",
      publishedAt: "2026-08-25T00:00:00.000Z",
      impressions: 1800,
      engagements: 144,
      followers: 842,
      followersGained: 12,
      clicks: 41,
    }),
    socialRecord({
      id: "tiktok:@makeable:video-1",
      contentId: "video-1",
      platform: "tiktok",
      account: "@makeable",
      publishedAt: "2026-08-24T00:00:00.000Z",
      impressions: 900,
      engagements: 117,
      followers: 310,
      followersGained: 19,
      clicks: 18,
    }),
  ];

  // When: the private dashboard report is generated.
  const report = buildSocialDashboardReport(records, { now });

  // Then: totals and rankings reflect real post data rather than repeated snapshots.
  assert.equal(report.totalImpressions, 3900);
  assert.equal(report.totalEngagements, 357);
  assert.equal(report.followersGained, 41);
  assert.equal(report.totalClicks, 91);
  assert.equal(report.postsTotal, 3);
  assert.equal(report.engagementRate, 357 / 3900);
  assert.deepEqual(
    report.accounts.map((account) => ({
      rank: account.rank,
      platform: account.platform,
      account: account.account,
      impressions: account.impressions,
      followers: account.followers,
    })),
    [
      {
        rank: 1,
        platform: "instagram",
        account: "@makeable.build",
        impressions: 3000,
        followers: 842,
      },
      {
        rank: 2,
        platform: "tiktok",
        account: "@makeable",
        impressions: 900,
        followers: 310,
      },
    ],
  );
  assert.deepEqual(
    report.content.map((content) => content.id),
    [
      "instagram:@makeable.build:reel-2",
      "instagram:@makeable.build:reel-1",
      "tiktok:@makeable:video-1",
    ],
  );
  assert.deepEqual(report.attribution, { status: "not_connected", daily: [] });
});

test("buildSocialDashboardReport includes normalized website-session attribution", () => {
  // Given: a validated server-side attribution aggregate.
  const attribution = {
    status: "connected",
    daily: [{
      date: "2026-08-26",
      platform: "instagram",
      accountKey: "makeable_zak",
      websiteSessions: 3,
    }],
  };

  // When: the report is built for the authenticated dashboard.
  const report = buildSocialDashboardReport([], { now, attribution });

  // Then: the report includes only the normalized attribution contract.
  assert.deepEqual(report.attribution, attribution);
});

test("buildSocialDashboardReport does not invent totals for unknown stored metrics", () => {
  // Given: one record whose private click and follower-gain metrics are unavailable.
  const records = [socialRecord({
    coverage: "public-snapshot",
    engagementsComplete: false,
    followersGained: null,
    clicks: null,
  })];

  // When: the stored records are normalized and summarized.
  const report = buildSocialDashboardReport(records, { now });

  // Then: null survives storage normalization, account aggregation, and report totals.
  assert.equal(report.records[0].followersGained, null);
  assert.equal(report.records[0].clicks, null);
  assert.equal(report.accounts[0].followersGained, null);
  assert.equal(report.accounts[0].clicks, null);
  assert.equal(report.followersGained, null);
  assert.equal(report.totalClicks, null);
});

test("mergeSocialRecords updates matching posts without duplicating prior imports", () => {
  // Given: an earlier import and a refreshed row for the same post.
  const existing = [socialRecord({ impressions: 100, engagements: 10 })];
  const incoming = [
    socialRecord({ impressions: 180, engagements: 24 }),
    socialRecord({
      id: "youtube:@makeable:short-2",
      platform: "youtube",
      account: "@makeable",
      contentId: "short-2",
      impressions: 400,
      engagements: 44,
    }),
  ];

  // When: a second file is imported.
  const merged = mergeSocialRecords(existing, incoming);

  // Then: the matching post is refreshed and the new post is appended.
  assert.equal(merged.length, 2);
  assert.equal(merged.find((record) => record.id === existing[0].id).impressions, 180);
  assert.equal(merged.find((record) => record.id === existing[0].id).engagements, 24);
});

test("mergeSocialRecords preserves bounded range-specific account analytics", () => {
  const incoming = [socialRecord({
    accountAnalytics: {
      7: { clicks: 24, followersGained: 31 },
      30: { clicks: 112, followersGained: 156 },
      90: { clicks: 112, followersGained: 156 },
    },
  })];

  const [merged] = mergeSocialRecords([], incoming);

  assert.deepEqual(merged.accountAnalytics, incoming[0].accountAnalytics);
});

test("reconcileRefreshedSocialRecords replaces successful sources and preserves failed ones", () => {
  const existing = [
    socialRecord({ contentId: "stale-instagram", id: "instagram:@makeable.build:stale-instagram" }),
    socialRecord({ platform: "facebook", account: "Makeable Facebook", attributionKey: "makeable_facebook", contentId: "kept-facebook", id: "facebook:Makeable Facebook:kept-facebook" }),
  ];
  const incoming = [
    socialRecord({ contentId: "current-instagram", id: "instagram:@makeable.build:current-instagram", impressions: 2400 }),
  ];

  const reconciled = reconcileRefreshedSocialRecords(existing, incoming, ["instagram"]);

  assert.equal(reconciled.some(({ contentId }) => contentId === "stale-instagram"), false);
  assert.equal(reconciled.some(({ contentId }) => contentId === "current-instagram"), true);
  assert.equal(reconciled.some(({ contentId }) => contentId === "kept-facebook"), true);
});

test("readSocialRecords seeds the truthful eight-post baseline in a clean store", async () => {
  // Given: a newly deployed store with no operator import.
  const store = new MemoryStore();

  // When: the dashboard reads its records.
  const records = await readSocialRecords(store);
  const report = buildSocialDashboardReport(records, { now });

  // Then: both Instagram accounts and all measured exposures are immediately present.
  assert.equal(report.postsTotal, 8);
  assert.equal(report.accounts.length, 2);
  assert.equal(report.totalExposures, 7_339);
  assert.deepEqual(
    report.accounts.map(({ account, posts }) => ({ account, posts })),
    [
      { account: "@makeable.build", posts: 3 },
      { account: "@makeable.zak", posts: 5 },
    ],
  );
});

test("readSocialRecords lets a stored post update its seeded identity without duplication", async () => {
  // Given: an import that refreshes one seeded post with a newer measured value.
  const store = new MemoryStore();
  await store.setJSON("v1/social-records.json", {
    records: [socialRecord({
      id: "ignored-by-normalization",
      contentId: "DcgtZHVA9Y7",
      impressions: 2_000,
      engagements: 75,
    })],
  });

  // When: defaults and stored records are merged by stable post identity.
  const records = await readSocialRecords(store);

  // Then: the refresh replaces the seed instead of creating a ninth post.
  assert.equal(records.length, 8);
  assert.equal(
    records.find((record) => record.contentId === "DcgtZHVA9Y7").impressions,
    2_000,
  );
});

test("readSocialRecords does not restore stale seed posts after a reconciled refresh", async () => {
  const store = new MemoryStore();
  await store.setJSON("v1/social-records.json", {
    schemaVersion: 2,
    records: [socialRecord({ contentId: "current-only", id: "instagram:@makeable.build:current-only" })],
  });

  const records = await readSocialRecords(store);

  assert.deepEqual(records.map(({ contentId }) => contentId), ["current-only"]);
});

test("dashboardSocialResult imports and persists new social posts", async () => {
  // Given: an empty private store and a one-row normalized CSV import.
  const store = new MemoryStore();
  const csv = [
    "platform,account,published_at,content_id,content_type,caption,impressions,engagements,followers_current,followers_gained,clicks,thumbnail_url,preview_url,post_url",
    "youtube,@makeable,2026-08-25,short-1,short,Desk build,2200,198,410,22,47,,,,",
  ].join("\n");

  // When: the authenticated endpoint service handles the import.
  const attribution = {
    status: "connected",
    daily: [{
      date: "2026-08-26",
      platform: "youtube",
      accountKey: "makeable",
      websiteSessions: 7,
    }],
  };
  const result = await dashboardSocialResult(
    { method: "POST", body: { csv } },
    { store, now, attribution },
  );

  // Then: the response reports the imported post and the store retains it.
  assert.equal(result.status, 200);
  assert.equal(result.body.imported, 1);
  assert.equal(result.body.report.totalImpressions, 9_539);
  assert.deepEqual(result.body.report.attribution, attribution);
  assert.equal((await store.get("v1/social-records.json")).records.length, 9);
});

test("dashboardSocialResult rejects extra import fields before storage", async () => {
  // Given: a request body with an unexpected boundary field.
  const store = new MemoryStore();

  // When: the endpoint service parses the request.
  const result = await dashboardSocialResult(
    { method: "POST", body: { csv: "ignored", overwrite: true } },
    { store, now },
  );

  // Then: the boundary rejects the request and no data is written.
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "Upload one valid social CSV file." });
  assert.equal(store.values.size, 0);
});

function socialRecord(overrides = {}) {
  return {
    id: "instagram:@makeable.build:reel-1",
    platform: "instagram",
    account: "@makeable.build",
    publishedAt: "2026-08-25T00:00:00.000Z",
    contentId: "reel-1",
    contentType: "reel",
    caption: "Building Ember on a real desk",
    impressions: 100,
    engagements: 10,
    followers: 100,
    followersGained: 2,
    clicks: 4,
    thumbnailUrl: "",
    previewUrl: "",
    postUrl: "",
    ...overrides,
  };
}

class MemoryStore {
  values = new Map();

  async get(key) {
    return this.values.get(key) || null;
  }

  async setJSON(key, value) {
    this.values.set(key, structuredClone(value));
  }
}
