const DASHBOARD_TIME_ZONE = "America/Los_Angeles";

export async function readJsonBlobRecords(store, prefix) {
  const values = [];
  for await (const page of store.list({ prefix, paginate: true })) {
    const records = await Promise.all(
      page.blobs.map((blob) => store.get(blob.key, {
        type: "json",
        consistency: "strong",
      })),
    );
    values.push(...records.filter(Boolean));
  }
  return values;
}

export function buildDashboardReport(waitlistRecords, builderSessions, galleryRecords, options = {}) {
  const generatedAt = validTimestamp(
    options.now instanceof Date
      ? options.now.toISOString()
      : String(options.now || new Date().toISOString()),
  );
  if (!generatedAt) throw new Error("A valid dashboard timestamp is required");
  const timeZone = options.timeZone || DASHBOARD_TIME_ZONE;

  const waitlistByEmail = new Map();
  for (const record of waitlistRecords) {
    const normalized = normalizeWaitlistRecord(record);
    if (!normalized) continue;
    const existing = waitlistByEmail.get(normalized.email);
    waitlistByEmail.set(
      normalized.email,
      existing ? mergeWaitlistRecords(existing, normalized) : normalized,
    );
  }

  const accountsBySub = normalizeBuilderAccounts(builderSessions);
  const projectsBySub = normalizeProjects(galleryRecords);
  const recordsByEmail = new Map(waitlistByEmail);

  for (const account of accountsBySub.values()) {
    const existing = recordsByEmail.get(account.email);
    const projects = projectsBySub.get(account.sub) || [];
    const latestProject = projects.at(-1) || null;
    const latestActivityAt = [account.lastSeenAt, latestProject?.claimedAt]
      .filter(Boolean)
      .sort()
      .at(-1) || account.lastSeenAt;
    recordsByEmail.set(account.email, {
      email: account.email,
      name: account.name || existing?.name || "",
      source: "google",
      sources: [...new Set([...(existing?.sources || []), "google"])].sort(sourceSortOrder),
      createdAt: existing?.createdAt && existing.createdAt < account.firstSeenAt
        ? existing.createdAt
        : account.firstSeenAt,
      firstBuilderSeenAt: account.firstSeenAt,
      lastActivityAt: latestActivityAt,
      buildCount: projects.length,
      latestProject: latestProject?.title || "",
      latestProjectAt: latestProject?.claimedAt || "",
      builderAccount: true,
      wasStoredInWaitlist: Boolean(existing),
    });
  }

  for (const [email, record] of recordsByEmail) {
    if (record.builderAccount) continue;
    recordsByEmail.set(email, {
      ...record,
      firstBuilderSeenAt: "",
      lastActivityAt: record.createdAt,
      buildCount: 0,
      latestProject: "",
      latestProjectAt: "",
      builderAccount: false,
      wasStoredInWaitlist: true,
    });
  }

  const records = [...recordsByEmail.values()].sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt)
    || right.createdAt.localeCompare(left.createdAt)
    || left.email.localeCompare(right.email),
  );
  const allProjects = [...projectsBySub.values()].flat();
  const projectOwners = [...projectsBySub.keys()].filter((sub) => accountsBySub.has(sub));
  const unmatchedProjectOwners = [...projectsBySub.keys()].filter((sub) => !accountsBySub.has(sub));
  const originalWaitlistEmails = new Set(waitlistByEmail.keys());
  const activity = buildDailyActivity(records, accountsBySub, allProjects, generatedAt, timeZone);
  const today = calendarDay(generatedAt, timeZone);
  const lastSevenDaysStart = dayNumber(today) - (6 * 86_400_000);

  return {
    generatedAt,
    timeZone,
    total: records.length,
    googleTotal: records.filter((record) => record.sources.includes("google")).length,
    buildInterestTotal: records.filter(
      (record) => record.sources.includes("make-a-build"),
    ).length,
    todayTotal: records.filter((record) => calendarDay(record.createdAt, timeZone) === today).length,
    lastSevenDaysTotal: records.filter(
      (record) => dayNumber(calendarDay(record.createdAt, timeZone)) >= lastSevenDaysStart,
    ).length,
    builderAccountsTotal: accountsBySub.size,
    projectOwnersTotal: new Set(projectOwners).size,
    publicProjectsTotal: allProjects.length,
    activeTodayTotal: records.filter(
      (record) => calendarDay(record.lastActivityAt, timeZone) === today,
    ).length,
    dataHealth: {
      builderAccountsMissingFromWaitlist: [...accountsBySub.values()].filter(
        (account) => !originalWaitlistEmails.has(account.email),
      ).length,
      unmatchedProjectOwners: unmatchedProjectOwners.length,
    },
    growth: activity.map((item) => ({
      date: item.date,
      signups: item.newContacts,
      total: item.totalContacts,
    })),
    activity,
    records,
  };
}

export function dashboardCsv(records) {
  const rows = [[
    "email",
    "name",
    "source",
    "first_contact_at",
    "first_builder_seen_at",
    "last_activity_at",
    "project_count",
    "latest_project",
    "latest_project_at",
  ]];
  for (const record of records) {
    rows.push([
      record.email,
      record.name,
      Array.isArray(record.sources) ? record.sources.join("+") : record.source,
      record.createdAt,
      record.firstBuilderSeenAt,
      record.lastActivityAt,
      record.buildCount,
      record.latestProject,
      record.latestProjectAt,
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function normalizeBuilderAccounts(sessions) {
  const accounts = new Map();
  for (const session of sessions) {
    const sub = cleanText(session?.user?.sub, 255);
    const email = normalizeEmail(session?.user?.email);
    const createdAt = validTimestamp(session?.createdAt || session?.user?.createdAt);
    if (!sub || !email || !createdAt) continue;
    const existing = accounts.get(sub);
    accounts.set(sub, {
      sub,
      email,
      name: cleanText(session?.user?.name, 120) || existing?.name || "",
      firstSeenAt: existing?.firstSeenAt && existing.firstSeenAt < createdAt
        ? existing.firstSeenAt
        : createdAt,
      lastSeenAt: existing?.lastSeenAt && existing.lastSeenAt > createdAt
        ? existing.lastSeenAt
        : createdAt,
    });
  }
  return accounts;
}

function normalizeProjects(galleryRecords) {
  const projects = new Map();
  for (const record of galleryRecords) {
    if (!record || record.publishState === "hidden") continue;
    const sub = cleanText(record.ownerSub, 255);
    const claimedAt = validTimestamp(record.claimedAt || record.createdAt);
    const title = cleanText(record.title, 160);
    if (!sub || !claimedAt || !title) continue;
    const values = projects.get(sub) || [];
    values.push({ title, claimedAt, id: cleanText(record.id, 160) });
    values.sort((left, right) => left.claimedAt.localeCompare(right.claimedAt));
    projects.set(sub, values);
  }
  return projects;
}

function buildDailyActivity(records, accountsBySub, projects, generatedAt, timeZone) {
  const contactsByDay = countByDay(records.map((record) => record.createdAt), timeZone);
  const buildersByDay = countByDay(
    [...accountsBySub.values()].map((account) => account.firstSeenAt),
    timeZone,
  );
  const projectsByDay = countByDay(projects.map((project) => project.claimedAt), timeZone);
  const allDates = [
    ...contactsByDay.keys(),
    ...buildersByDay.keys(),
    ...projectsByDay.keys(),
    calendarDay(generatedAt, timeZone),
  ].sort();
  if (!allDates.length) return [];

  const output = [];
  let totalContacts = 0;
  let totalBuilders = 0;
  let totalProjects = 0;
  for (
    let cursor = dayNumber(allDates[0]);
    cursor <= dayNumber(allDates.at(-1));
    cursor += 86_400_000
  ) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const newContacts = contactsByDay.get(date) || 0;
    const newBuilders = buildersByDay.get(date) || 0;
    const projectsPublished = projectsByDay.get(date) || 0;
    totalContacts += newContacts;
    totalBuilders += newBuilders;
    totalProjects += projectsPublished;
    output.push({
      date,
      newContacts,
      newBuilders,
      projects: projectsPublished,
      totalContacts,
      totalBuilders,
      totalProjects,
    });
  }
  return output;
}

function countByDay(timestamps, timeZone) {
  const counts = new Map();
  for (const timestamp of timestamps) {
    const date = calendarDay(timestamp, timeZone);
    if (!date) continue;
    counts.set(date, (counts.get(date) || 0) + 1);
  }
  return counts;
}

function normalizeWaitlistRecord(record) {
  const email = normalizeEmail(record?.email);
  const createdAt = validTimestamp(record?.createdAt || record?.firstSeenAt);
  const sources = normalizedSources(record);
  if (!email || !createdAt || !sources.length) return null;
  return {
    email,
    name: cleanText(record?.name, 120),
    source: sources.includes("google") ? "google" : "make-a-build",
    sources,
    createdAt,
  };
}

function mergeWaitlistRecords(left, right) {
  const sources = [...new Set([...left.sources, ...right.sources])].sort(sourceSortOrder);
  const earliest = left.createdAt <= right.createdAt ? left : right;
  const google = right.source === "google" ? right : left.source === "google" ? left : null;
  return {
    email: left.email,
    name: google?.name || left.name || right.name,
    source: sources.includes("google") ? "google" : "make-a-build",
    sources,
    createdAt: earliest.createdAt,
  };
}

function normalizedSources(value) {
  const input = Array.isArray(value?.sources) ? value.sources : [value?.source];
  return [...new Set(input.filter((source) => new Set(["google", "make-a-build"]).has(source)))]
    .sort(sourceSortOrder);
}

function sourceSortOrder(left, right) {
  return (left === "google" ? 0 : 1) - (right === "google" ? 0 : 1);
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validTimestamp(value) {
  if (typeof value !== "string" || !value) return "";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
}

function calendarDay(value, timeZone) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(value) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error("A valid calendar date is required");
  return timestamp;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
