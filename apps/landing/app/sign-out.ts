type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type StorageLike = Pick<Storage, "length" | "key" | "removeItem"> & Partial<Pick<Storage, "getItem">>;

const SAVED_BUILD_JOB_KEY = "makeable:active-build-job:v1";
const JOB_ID_PATTERN = /^job_[A-Za-z0-9_-]+$/;

export function browserStorages(): StorageLike[] {
  try {
    return [window.localStorage, window.sessionStorage];
  } catch {
    return [];
  }
}

// Logs the user out of this browser:
// 1. Cancels any unfinished build this browser is following (saved for resume,
//    or passed in by the page), while the session can still prove ownership.
//    Otherwise the build would hold a credit that nobody could resume after
//    logging back in. Claimed or finished builds are left alone by the server.
// 2. Ends the server session.
// 3. Only if that worked, forgets what this browser saved for the user
//    (makeable:* keys). Returns false if the server did not confirm, so the
//    page can say the user is still signed in.
export async function signOut({
  fetch,
  url,
  storages,
  jobUrl,
  jobIds = [],
}: {
  fetch: FetchLike;
  url: string;
  storages: StorageLike[];
  jobUrl: (jobId: string) => string;
  jobIds?: string[];
}) {
  const jobsToCancel = new Set<string>();
  for (const storage of storages) {
    try {
      const saved = storage.getItem?.(SAVED_BUILD_JOB_KEY);
      if (saved) jobsToCancel.add(saved);
    } catch {
      // Storage can be blocked (private mode); nothing was saved there then.
    }
  }
  for (const jobId of jobIds) if (jobId) jobsToCancel.add(jobId);
  for (const jobId of jobsToCancel) {
    if (!JOB_ID_PATTERN.test(jobId)) continue;
    try {
      await fetch(jobUrl(jobId), { method: "DELETE", credentials: "include", headers: { Accept: "application/json" } });
    } catch {
      // A build that cannot be cancelled now still expires on the server.
    }
  }

  let ok = false;
  try {
    const response = await fetch(url, { method: "DELETE", credentials: "include", headers: { Accept: "application/json" } });
    ok = response.ok;
  } catch {
    ok = false;
  }
  if (!ok) return false;

  for (const storage of storages) {
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => Boolean(key?.startsWith("makeable:")));
      for (const key of keys) storage.removeItem(key);
    } catch {
      // Storage can be blocked (private mode); nothing was saved there then.
    }
  }
  return true;
}
