export async function readVerifiedWaitlist(store) {
  const recordsByEmail = new Map();
  for (const prefix of ["signup-", "build-interest-"]) {
    for await (const page of store.list({ prefix, paginate: true })) {
      const records = await Promise.all(
        page.blobs.map((blob) => store.get(blob.key, {
          type: "json",
          consistency: "strong",
        })),
      );
      for (const record of records) {
        const normalized = normalizeStoredRecord(record);
        if (!normalized) continue;
        const existing = recordsByEmail.get(normalized.email);
        recordsByEmail.set(
          normalized.email,
          existing ? mergeStoredRecords(existing, normalized) : normalized,
        );
      }
    }
  }
  return [...recordsByEmail.values()].sort((a, b) =>
    a.email.localeCompare(b.email),
  );
}

export function buildWaitlistReport(records, options = {}) {
  const generatedAt = validTimestamp(
    options.now instanceof Date
      ? options.now.toISOString()
      : String(options.now || new Date().toISOString()),
  );
  if (!generatedAt) throw new Error("A valid dashboard timestamp is required");

  const normalized = records
    .map(normalizeStoredRecord)
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totalsByDay = new Map();
  for (const record of normalized) {
    const day = record.createdAt.slice(0, 10);
    totalsByDay.set(day, (totalsByDay.get(day) || 0) + 1);
  }

  const today = generatedAt.slice(0, 10);
  const earliestDay = normalized.at(-1)?.createdAt.slice(0, 10) || "";
  const lastRecordDay = normalized[0]?.createdAt.slice(0, 10) || "";
  const endDay = lastRecordDay > today ? lastRecordDay : today;
  const growth = [];
  let runningTotal = 0;
  if (earliestDay) {
    for (let cursor = utcDay(earliestDay); cursor <= utcDay(endDay); cursor += 86_400_000) {
      const date = new Date(cursor).toISOString().slice(0, 10);
      const signups = totalsByDay.get(date) || 0;
      runningTotal += signups;
      growth.push({ date, signups, total: runningTotal });
    }
  }

  const lastSevenDaysStart = utcDay(today) - (6 * 86_400_000);
  return {
    generatedAt,
    total: normalized.length,
    googleTotal: normalized.filter((record) => record.sources.includes("google")).length,
    buildInterestTotal: normalized.filter(
      (record) => record.sources.includes("make-a-build"),
    ).length,
    todayTotal: totalsByDay.get(today) || 0,
    lastSevenDaysTotal: normalized.filter(
      (record) => utcDay(record.createdAt.slice(0, 10)) >= lastSevenDaysStart,
    ).length,
    growth,
    records: normalized,
  };
}

export function waitlistCsv(records) {
  const rows = ["email,name,source,created_at"];
  for (const record of records) {
    rows.push(
      [record.email, record.name, record.source, record.createdAt]
        .map(csvCell)
        .join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}

export function normalizeStoredWaitlistRecord(value) {
  return normalizeStoredRecord(value);
}

function normalizeStoredRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const email = normalizeEmail(value.email);
  if (!email || !new Set(["google", "make-a-build"]).has(value.source)) return null;
  const createdAt = validTimestamp(value.createdAt || value.firstSeenAt);
  if (!createdAt) return null;
  return {
    email,
    name: typeof value.name === "string" ? value.name.trim().slice(0, 120) : "",
    source: normalizedSources(value).includes("google") ? "google" : "make-a-build",
    sources: normalizedSources(value),
    createdAt,
  };
}

function mergeStoredRecords(existing, incoming) {
  const sources = [...new Set([...existing.sources, ...incoming.sources])]
    .sort(sourceSortOrder);
  const earliest = existing.createdAt <= incoming.createdAt ? existing : incoming;
  const google = incoming.source === "google"
    ? incoming
    : existing.source === "google"
      ? existing
      : null;
  return {
    email: existing.email,
    name: google?.name || existing.name || incoming.name,
    source: sources.includes("google") ? "google" : "make-a-build",
    sources,
    createdAt: earliest.createdAt,
  };
}

function normalizedSources(value) {
  const sources = Array.isArray(value.sources) ? value.sources : [value.source];
  const valid = sources.filter((source) => new Set(["google", "make-a-build"]).has(source));
  if (!valid.includes(value.source)) valid.push(value.source);
  return [...new Set(valid)].sort(sourceSortOrder);
}

function sourceSortOrder(left, right) {
  return (left === "google" ? 0 : 1) - (right === "google" ? 0 : 1);
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "";
  }
  return email;
}

function validTimestamp(value) {
  if (typeof value !== "string" || !value) return "";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
}

function utcDay(value) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error("A valid calendar date is required");
  return timestamp;
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
