import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDashboardReport,
  dashboardCsv,
} from "../lib/dashboard-report.mjs";

test("dashboard report separates first contact, builder activity, and projects", () => {
  const report = buildDashboardReport(
    [{
      email: "returning@example.com",
      name: "Returning Maker",
      source: "google",
      sources: ["google"],
      createdAt: "2026-08-19T18:00:00.000Z",
    }],
    [
      {
        createdAt: "2026-08-25T06:00:00.000Z",
        user: { sub: "google-1", email: "returning@example.com", name: "Returning Maker" },
      },
      {
        createdAt: "2026-08-25T20:00:00.000Z",
        user: { sub: "google-1", email: "returning@example.com", name: "Returning Maker" },
      },
      {
        createdAt: "2026-08-25T08:30:00.000Z",
        user: { sub: "google-2", email: "new@example.com", name: "New Maker" },
      },
    ],
    [
      {
        id: "project-1",
        ownerSub: "google-1",
        title: "Recent Project",
        claimedAt: "2026-08-25T19:05:00.000Z",
        publishState: "public",
      },
      {
        id: "project-2",
        ownerSub: "google-1",
        title: "Hidden Project",
        claimedAt: "2026-08-25T19:10:00.000Z",
        publishState: "hidden",
      },
    ],
    { now: new Date("2026-08-26T02:00:00.000Z") },
  );

  assert.equal(report.total, 2);
  assert.equal(report.builderAccountsTotal, 2);
  assert.equal(report.projectOwnersTotal, 1);
  assert.equal(report.publicProjectsTotal, 1);
  assert.equal(report.todayTotal, 1);
  assert.equal(report.activeTodayTotal, 2);
  assert.deepEqual(report.dataHealth, {
    builderAccountsMissingFromWaitlist: 1,
    unmatchedProjectOwners: 0,
  });

  const returning = report.records.find((record) => record.email === "returning@example.com");
  assert.equal(returning.createdAt, "2026-08-19T18:00:00.000Z");
  assert.equal(returning.firstBuilderSeenAt, "2026-08-25T06:00:00.000Z");
  assert.equal(returning.lastActivityAt, "2026-08-25T20:00:00.000Z");
  assert.equal(returning.buildCount, 1);
  assert.equal(returning.latestProject, "Recent Project");

  const aug24 = report.activity.find((day) => day.date === "2026-08-24");
  const aug25 = report.activity.find((day) => day.date === "2026-08-25");
  assert.equal(aug24.newBuilders, 1);
  assert.equal(aug25.newBuilders, 1);
  assert.equal(aug25.projects, 1);
  assert.equal(aug25.totalContacts, 2);
  assert.equal(JSON.stringify(report).includes("google-1"), false);
});

test("dashboard report exposes unmatched gallery ownership only as a health count", () => {
  const report = buildDashboardReport(
    [],
    [],
    [{
      id: "project-orphan",
      ownerSub: "private-google-subject",
      title: "Orphaned Project",
      claimedAt: "2026-08-25T12:00:00.000Z",
      publishState: "public",
    }],
    { now: new Date("2026-08-25T13:00:00.000Z") },
  );

  assert.equal(report.publicProjectsTotal, 1);
  assert.equal(report.projectOwnersTotal, 0);
  assert.equal(report.dataHealth.unmatchedProjectOwners, 1);
  assert.equal(JSON.stringify(report).includes("private-google-subject"), false);
});

test("dashboard CSV includes builder activity and remains formula-safe", () => {
  const csv = dashboardCsv([{
    email: "maker@example.com",
    name: "=IMPORTXML()",
    sources: ["google"],
    createdAt: "2026-08-22T00:00:00.000Z",
    firstBuilderSeenAt: "2026-08-22T00:00:00.000Z",
    lastActivityAt: "2026-08-25T00:00:00.000Z",
    buildCount: 2,
    latestProject: "Desk Pet",
    latestProjectAt: "2026-08-25T00:00:00.000Z",
  }]);

  assert.match(csv, /first_builder_seen_at/);
  assert.match(csv, /project_count/);
  assert.match(csv, /"'=IMPORTXML\(\)"/);
  assert.match(csv, /"Desk Pet"/);
});
