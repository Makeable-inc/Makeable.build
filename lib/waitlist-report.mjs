export async function readVerifiedWaitlist(store) {
  const recordsByEmail = new Map();
  for (const prefix of ["signup-", "build-interest-"]) {
    for await (const page of store.list({ prefix, paginate: true })) {
      const records = await Promise.all(
        page.blobs.map((blob) => store.get(blob.key, { type: "json" })),
      );
      for (const record of records) {
        const normalized = normalizeStoredRecord(record);
        if (!normalized) continue;
        const existing = recordsByEmail.get(normalized.email);
        if (!existing || normalized.createdAt < existing.createdAt) {
          recordsByEmail.set(normalized.email, normalized);
        }
      }
    }
  }
  return [...recordsByEmail.values()].sort((a, b) =>
    a.email.localeCompare(b.email),
  );
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
    source: value.source,
    createdAt,
  };
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

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
