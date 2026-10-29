export function buildLibrary<T>(accountBuilds: readonly T[], publicBuilds: readonly T[], signedIn: boolean): readonly T[] {
  return signedIn ? accountBuilds : publicBuilds;
}

export type AccountLoad<User, Build, Quota> =
  | { state: "signed-in"; user: User; builds: Build[]; quota: Quota }
  | { state: "signed-out" }
  | { state: "unavailable" };

export type PublicLoad<Build> = { state: "ok"; builds: Build[] } | { state: "failed" };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Loads the signed-in user's builds and the public gallery as two independent
// requests, each with its own time limit and error handling, so a slow,
// failing or malformed account response never holds back or hides the public
// builds. Neither promise rejects.
export function loadBuildLibrary<User, Build, Quota>({
  fetch,
  accountUrl,
  publicUrl,
  timeoutMs = 10000,
}: {
  fetch: FetchLike;
  accountUrl: string;
  publicUrl: string;
  timeoutMs?: number;
}): { account: Promise<AccountLoad<User, Build, Quota>>; publicBuilds: Promise<PublicLoad<Build>> } {
  const account = getJson(fetch, accountUrl, { credentials: "include" }, timeoutMs).then((result): AccountLoad<User, Build, Quota> => {
    if (result.status === 401) return { state: "signed-out" };
    const body = result.body as { user?: User; builds?: unknown; quota?: Quota } | null;
    if (!result.ok || !body || typeof body !== "object" || !body.user) return { state: "unavailable" };
    return {
      state: "signed-in",
      user: body.user,
      builds: Array.isArray(body.builds) ? body.builds as Build[] : [],
      quota: body.quota as Quota,
    };
  });
  const publicBuilds = getJson(fetch, publicUrl, {}, timeoutMs).then((result): PublicLoad<Build> => {
    const builds = (result.body as { builds?: unknown } | null)?.builds;
    return result.ok && Array.isArray(builds) ? { state: "ok", builds: builds as Build[] } : { state: "failed" };
  });
  return { account, publicBuilds };
}

async function getJson(fetch: FetchLike, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, headers: { Accept: "application/json" }, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      return { ok: false, status: response.status, body: null };
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
