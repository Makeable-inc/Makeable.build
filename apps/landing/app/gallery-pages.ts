// The homepage gallery loads public builds a page at a time instead of the
// whole list, which grows with every saved build.
export const GALLERY_PAGE_SIZE = 24;

export type GalleryPage<Build> = { ok: true; builds: Build[]; nextCursor: string | null } | { ok: false };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function galleryPageUrl(cursor: string) {
  const query = `limit=${GALLERY_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  return `/api/builds?${query}`;
}

export async function loadGalleryPage<Build>(
  fetch: FetchLike,
  url: string,
  timeoutMs = 10000,
  signal?: AbortSignal,
): Promise<GalleryPage<Build>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", () => controller.abort());
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return { ok: false };
    const body = await response.json() as { builds?: unknown; nextCursor?: unknown } | null;
    if (!Array.isArray(body?.builds)) return { ok: false };
    return { ok: true, builds: body.builds as Build[], nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : null };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export function appendGalleryPage<Build extends { id: string }>(shown: readonly Build[], page: readonly Build[]): Build[] {
  const seen = new Set(shown.map((build) => build.id));
  return [...shown, ...page.filter((build) => !seen.has(build.id))];
}
