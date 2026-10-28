type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type StorageLike = Pick<Storage, "length" | "key" | "removeItem">;

export function browserStorages(): StorageLike[] {
  try {
    return [window.localStorage, window.sessionStorage];
  } catch {
    return [];
  }
}

// Ends the server session and forgets what this browser saved for the signed-in
// user (the build job in progress, the last opened project). Returns false if
// the server did not confirm, so the page can say so instead of pretending.
export async function signOut({ fetch, url, storages }: { fetch: FetchLike; url: string; storages: StorageLike[] }) {
  let ok = false;
  try {
    const response = await fetch(url, { method: "DELETE", credentials: "include", headers: { Accept: "application/json" } });
    ok = response.ok;
  } catch {
    ok = false;
  }
  for (const storage of storages) {
    try {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => Boolean(key?.startsWith("makeable:")));
      for (const key of keys) storage.removeItem(key);
    } catch {
      // Storage can be blocked (private mode); nothing was saved there then.
    }
  }
  return ok;
}
