// Tab-scoped draft only: no credential, job, or automatic-submit intent.
export const IDEA_DRAFT_KEY = "makeable:idea-draft:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readIdeaDraft(storage, now = Date.now()) {
  try {
    const draft = JSON.parse(storage.getItem(IDEA_DRAFT_KEY) || "null");
    if (typeof draft?.idea === "string" && draft.idea.length <= 20000
      && Number.isFinite(draft.updatedAt) && now >= draft.updatedAt
      && now - draft.updatedAt < MAX_AGE_MS) return draft.idea;
    storage.removeItem(IDEA_DRAFT_KEY);
  } catch { /* Unavailable or corrupt storage must not block sign-in. */ }
  return "";
}

export function writeIdeaDraft(storage, idea, now = Date.now()) {
  try {
    if (!idea.trim()) storage.removeItem(IDEA_DRAFT_KEY);
    else storage.setItem(IDEA_DRAFT_KEY, JSON.stringify({ idea, updatedAt: now }));
  } catch { /* Keep the in-memory composer usable if storage is unavailable. */ }
}
