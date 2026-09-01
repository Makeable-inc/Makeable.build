import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSocialView,
  mediaKind,
} from "../dashboard/social-model.js";

const now = new Date("2026-08-26T18:00:00.000Z");

test("buildSocialView filters the selected range and ranks by engagement", () => {
  // Given: one recent post and one post outside the 30-day window.
  const records = [
    record({
      id: "instagram:@makeable:recent",
      publishedAt: "2026-08-20T00:00:00.000Z",
      impressions: 1000,
      engagements: 50,
    }),
    record({
      id: "tiktok:@makeable:old",
      platform: "tiktok",
      publishedAt: "2026-06-01T00:00:00.000Z",
      impressions: 9000,
      engagements: 900,
    }),
    record({
      id: "youtube:@makeable:recent",
      platform: "youtube",
      publishedAt: "2026-08-22T00:00:00.000Z",
      impressions: 600,
      engagements: 120,
    }),
  ];

  // When: the Social view shows the last 30 days ranked by engagement.
  const view = buildSocialView(records, {
    days: 30,
    rankBy: "engagements",
    now,
  });

  // Then: old content is excluded and the highest recent engagement ranks first.
  assert.equal(view.totalImpressions, 1600);
  assert.equal(view.totalExposures, 1600);
  assert.equal(view.totalEngagements, 170);
  assert.deepEqual(
    view.accounts.map((account) => account.platform),
    ["youtube", "instagram"],
  );
});

test("buildSocialView keeps public engagement partial and joins website sessions", () => {
  // Given: complete platform data and a public snapshot with account-level attribution.
  const records = [
    record({
      account: "@makeable.build",
      attributionKey: "makeable_build",
      impressions: 1000,
    }),
    record({
      id: "instagram:@makeable.zak:reel-1",
      account: "@makeable.zak",
      attributionKey: "makeable_zak",
      coverage: "public-snapshot",
      engagementsComplete: false,
      impressions: 500,
      engagements: 15,
      clicks: null,
      followersGained: null,
    }),
  ];

  // When: the selected range is joined to validated website-session attribution.
  const view = buildSocialView(records, {
    days: 30,
    rankBy: "impressions",
    now,
    attribution: {
      status: "connected",
      daily: [
        {
          date: "2026-08-20",
          platform: "instagram",
          accountKey: "makeable_build",
          websiteSessions: 8,
        },
        {
          date: "2026-08-20",
          platform: "instagram",
          accountKey: "makeable_zak",
          websiteSessions: 3,
        },
      ],
    },
  });

  // Then: exposures and measured owner metrics remain additive while the public account stays unknown.
  assert.equal(view.totalExposures, 1500);
  assert.equal(view.engagementRate, 50 / 1000);
  assert.equal(view.websiteSessions, 11);
  assert.equal(view.websiteVisitRate, 11 / 1500);
  assert.equal(view.accounts[1].coverage, "public-snapshot");
  assert.equal(view.accounts[1].engagementRate, null);
  assert.equal(view.accounts[1].clicks, null);
  assert.equal(view.accounts[1].websiteSessions, 3);
  assert.equal(view.totalClicks, 8);
  assert.equal(view.followersGained, 3);
  assert.equal(view.daily.find((point) => point.date === "2026-08-20").clicks, null);
});

test("buildSocialView distinguishes disconnected attribution from connected zero", () => {
  // Given: a platform record and two explicit unavailable attribution states.
  const records = [record()];

  // When/Then: disconnected and unavailable states retain unknown website metrics.
  for (const status of ["not_connected", "unavailable"]) {
    const view = buildSocialView(records, {
      days: 30,
      now,
      attribution: { status, daily: [] },
    });
    assert.equal(view.websiteSessions, null);
    assert.equal(view.websiteVisitRate, null);
    assert.equal(view.accounts[0].websiteSessions, null);
    assert.equal(view.accounts[0].websiteVisitRate, null);
  }

  // When: attribution is connected but has no matching rows.
  const connected = buildSocialView(records, {
    days: 30,
    now,
    attribution: { status: "connected", daily: [] },
  });

  // Then: zero is reported as measured data.
  assert.equal(connected.websiteSessions, 0);
  assert.equal(connected.websiteVisitRate, 0);
  assert.equal(connected.accounts[0].websiteSessions, 0);
  assert.equal(connected.accounts[0].websiteVisitRate, 0);
});

test("buildSocialView joins attribution only on exact keys inside the UTC range", () => {
  // Given: one matching row plus wrong-platform, wrong-account, old, and future rows.
  const records = [record({ attributionKey: "makeable" })];
  const daily = [
    { date: "2026-08-20", platform: "instagram", accountKey: "makeable", websiteSessions: 8 },
    { date: "2026-08-20", platform: "tiktok", accountKey: "makeable", websiteSessions: 90 },
    { date: "2026-08-20", platform: "instagram", accountKey: "makeable_zak", websiteSessions: 70 },
    { date: "2026-07-27", platform: "instagram", accountKey: "makeable", websiteSessions: 50 },
    { date: "2026-08-27", platform: "instagram", accountKey: "makeable", websiteSessions: 30 },
  ];

  // When: the 30-day UTC view joins attribution.
  const view = buildSocialView(records, {
    days: 30,
    now,
    attribution: { status: "connected", daily },
  });

  // Then: only the exact platform/account key within July 28 through August 26 is counted.
  assert.equal(view.websiteSessions, 8);
  assert.equal(view.accounts[0].websiteSessions, 8);
});

test("buildSocialView assigns one session bucket to renamed display accounts", () => {
  // Given: two display labels for one normalized platform and attribution identity.
  const records = [
    record({ id: "instagram:@old-name:post-1", platform: "Instagram", account: "@old-name", attributionKey: "makeable_build", publishedAt: "2026-08-19T00:00:00.000Z", impressions: 100 }),
    record({ id: "instagram:@new-name:post-2", account: "@new-name", attributionKey: "makeable_build", publishedAt: "2026-08-22T00:00:00.000Z", impressions: 200 }),
  ];

  // When: the shared attribution bucket is joined to the account view.
  const view = buildSocialView(records, {
    days: 30,
    now,
    attribution: connectedAttribution(session("makeable_build", 7)),
  });

  // Then: the bucket is assigned once and the newest display label represents the identity.
  assert.equal(view.websiteSessions, 7);
  assert.equal(view.accounts.length, 1);
  assert.equal(view.accounts[0].platform, "instagram");
  assert.equal(view.accounts[0].account, "@new-name");
  assert.equal(view.accounts[0].attributionKey, "makeable_build");
  assert.equal(view.accounts[0].impressions, 300);
  assert.equal(view.accounts[0].websiteSessions, 7);
});

test("buildSocialView keeps changed attribution keys as distinct account identities", () => {
  // Given: one display label whose older and newer content use different exact keys.
  const records = [
    record({ id: "instagram:@makeable:legacy", attributionKey: "makeable_legacy", publishedAt: "2026-08-19T00:00:00.000Z", impressions: 200 }),
    record({ id: "instagram:@makeable:current", attributionKey: "makeable_current", publishedAt: "2026-08-22T00:00:00.000Z", impressions: 100 }),
  ];

  // When: each attribution bucket is joined and ranked by its measured sessions.
  const view = buildSocialView(records, {
    days: 30,
    rankBy: "websiteSessions",
    now,
    attribution: connectedAttribution(
      session("makeable_legacy", 4),
      session("makeable_current", 6),
    ),
  });

  // Then: both identities remain visible and each exact bucket contributes once globally.
  assert.equal(view.websiteSessions, 10);
  assert.deepEqual(
    view.accounts.map(({ account, attributionKey, websiteSessions }) => ({
      account,
      attributionKey,
      websiteSessions,
    })),
    [
      { account: "@makeable", attributionKey: "makeable_current", websiteSessions: 6 },
      { account: "@makeable", attributionKey: "makeable_legacy", websiteSessions: 4 },
    ],
  );
});

test("buildSocialView ranks measured visit rates above zero and null deterministically", () => {
  // Given: positive, zero, and denominator-less account conversion rates.
  const records = [
    record({ account: "@alpha", attributionKey: "alpha", impressions: 100 }),
    record({ account: "@aardvark", attributionKey: "aardvark", impressions: 100 }),
    record({ account: "@beta", attributionKey: "beta", impressions: 1000 }),
    record({ account: "@unknown", attributionKey: "unknown", impressions: 0 }),
  ];
  const daily = [
    { date: "2026-08-20", platform: "instagram", accountKey: "alpha", websiteSessions: 10 },
    { date: "2026-08-20", platform: "instagram", accountKey: "aardvark", websiteSessions: 10 },
    { date: "2026-08-20", platform: "instagram", accountKey: "unknown", websiteSessions: 4 },
  ];

  // When: accounts are ranked by website visit rate.
  const view = buildSocialView(records, {
    days: 30,
    rankBy: "websiteVisitRate",
    now,
    attribution: { status: "connected", daily },
  });

  // Then: 10% ranks above measured zero, and null ranks last as the least-known value.
  assert.deepEqual(
    view.accounts.map(({ account, websiteVisitRate }) => ({ account, websiteVisitRate })),
    [
      { account: "@aardvark", websiteVisitRate: 0.1 },
      { account: "@alpha", websiteVisitRate: 0.1 },
      { account: "@beta", websiteVisitRate: 0 },
      { account: "@unknown", websiteVisitRate: null },
    ],
  );
});

test("buildSocialView uses range-specific owner clicks and follower gains", () => {
  const source = record({
    publishedAt: "2026-08-30T00:00:00.000Z",
    clicks: null,
    followersGained: null,
    accountAnalytics: {
      7: { clicks: 24, followersGained: 31 },
      30: { clicks: 112, followersGained: 156 },
      90: { clicks: 112, followersGained: 156 },
    },
  });

  const thirtyDays = buildSocialView([source], {
    days: 30,
    now: new Date("2026-08-31T12:00:00.000Z"),
  });
  const sevenDays = buildSocialView([source], {
    days: 7,
    now: new Date("2026-08-31T12:00:00.000Z"),
  });

  assert.equal(thirtyDays.accounts[0].clicks, 112);
  assert.equal(thirtyDays.accounts[0].followersGained, 156);
  assert.equal(thirtyDays.totalClicks, 112);
  assert.equal(thirtyDays.followersGained, 156);
  assert.equal(sevenDays.accounts[0].clicks, 24);
  assert.equal(sevenDays.accounts[0].followersGained, 31);
});

test("buildSocialView preserves the last-verified status for retained owner metrics", () => {
  const view = buildSocialView([record({
    coverage: "stale",
    accountAnalytics: {
      30: { clicks: 113, followersGained: 155 },
    },
  })], {
    days: 30,
    now: new Date("2026-08-31T12:00:00.000Z"),
  });

  assert.equal(view.accounts[0].coverage, "stale");
  assert.equal(view.accounts[0].clicks, 113);
  assert.equal(view.accounts[0].followersGained, 155);
});

test("buildSocialView totals measured owner metrics without discarding them for unknown accounts", () => {
  const measured = record({
    account: "@measured",
    attributionKey: "measured",
    publishedAt: "2026-08-30T00:00:00.000Z",
    clicks: null,
    followersGained: null,
    accountAnalytics: {
      30: { clicks: 113, followersGained: 155 },
    },
  });
  const unknown = record({
    platform: "youtube",
    account: "@unknown",
    attributionKey: "unknown",
    publishedAt: "2026-08-30T00:00:00.000Z",
    clicks: null,
    followersGained: null,
  });

  const view = buildSocialView([measured, unknown], {
    days: 30,
    now: new Date("2026-08-31T12:00:00.000Z"),
  });

  assert.equal(view.totalClicks, 113);
  assert.equal(view.followersGained, 155);
  assert.equal(view.accounts.find(({ account }) => account === "@unknown").clicks, null);
  assert.equal(view.accounts.find(({ account }) => account === "@unknown").followersGained, null);
});

test("mediaKind chooses inline video, thumbnail, or unavailable presentation", () => {
  // Given/When/Then: media capability maps to the correct in-dashboard treatment.
  assert.equal(mediaKind(record({ previewUrl: "https://cdn.example.com/a.mp4" })), "video");
  assert.equal(mediaKind(record({ thumbnailUrl: "https://cdn.example.com/a.jpg" })), "image");
  assert.equal(mediaKind(record()), "unavailable");
});

test("buildSocialView groups the same cross-posted video and retains every platform", () => {
  const shared = {
    caption: "Anything is Makeable #makeable",
    contentType: "video",
    publishedAt: "2026-08-24T00:00:00.000Z",
  };
  const view = buildSocialView([
    record({ ...shared, id: "instagram:@makeable.build:ig-1", contentId: "ig-1", impressions: 1200 }),
    record({ ...shared, id: "tiktok:@trymakeable.build:tt-1", platform: "tiktok", account: "@trymakeable.build", attributionKey: "trymakeable_build", contentId: "tt-1", impressions: 800, embedUrl: "https://www.tiktok.com/player/v1/tt-1" }),
    record({ ...shared, id: "youtube:@makeablebuild:yt-1", platform: "youtube", account: "@makeablebuild", attributionKey: "makeable_youtube", contentId: "yt-1", impressions: 600, embedUrl: "https://www.youtube.com/embed/yt-1" }),
  ], { days: 30, now });

  assert.equal(view.content.length, 1);
  assert.equal(view.content[0].impressions, 2600);
  assert.deepEqual(view.content[0].crossPosts.map(({ platform }) => platform).sort(), ["instagram", "tiktok", "youtube"]);
  assert.equal(mediaKind(view.content[0]), "video");
});

test("buildSocialView keeps a low-volume connected account in the bounded gallery", () => {
  const records = Array.from({ length: 17 }, (_, index) => record({
    id: `instagram:@makeable:ig-${index}`,
    contentId: `ig-${index}`,
    caption: `Distinct Instagram video ${index}`,
    impressions: 10_000 - index,
  }));
  records.push(record({
    id: "facebook:Makeable Facebook:fb-low",
    platform: "facebook",
    account: "Makeable Facebook",
    attributionKey: "makeable_facebook",
    contentId: "fb-low",
    caption: "Distinct Facebook video",
    impressions: 1,
  }));

  const view = buildSocialView(records, { days: 30, now });

  assert.equal(view.content.length, 16);
  assert.equal(view.content.some((group) => group.crossPosts.some(({ platform }) => platform === "facebook")), true);
});

function record(overrides = {}) {
  return {
    id: "instagram:@makeable:post-1",
    platform: "instagram",
    account: "@makeable",
    publishedAt: "2026-08-20T00:00:00.000Z",
    contentId: "post-1",
    contentType: "video",
    caption: "Making Ember",
    impressions: 1000,
    engagements: 50,
    followers: 100,
    followersGained: 3,
    clicks: 8,
    coverage: "platform-only",
    attributionKey: "makeable",
    engagementsComplete: true,
    thumbnailUrl: "",
    previewUrl: "",
    postUrl: "",
    ...overrides,
  };
}

function connectedAttribution(...daily) {
  return { status: "connected", daily };
}

function session(accountKey, websiteSessions) {
  return { date: "2026-08-20", platform: "instagram", accountKey, websiteSessions };
}
