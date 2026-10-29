type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type StorageLike = Pick<Storage, "length" | "key" | "removeItem">;

export function browserStorages(): StorageLike[] {
  try {
    return [window.localStorage, window.sessionStorage];
  } catch {
    return [];
  }
}

// Logs the user out of this browser: ends the server session, then, only if
// that worked, forgets what this browser saved for the user (makeable:* keys).
// Returns false if the server did not confirm, so the page can say the user is
// still signed in. A build still running is left alone; it belongs to the
// account, not the browser.
export async function signOut({
  fetch,
  url,
  storages,
}: {
  fetch: FetchLike;
  url: string;
  storages: StorageLike[];
}) {
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
