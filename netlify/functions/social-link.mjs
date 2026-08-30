import { socialLinkRedirect } from "../../lib/social-links.mjs";

export default async function handler(request) {
  if (!new Set(["GET", "HEAD"]).has(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  const redirect = socialLinkRedirect(new URL(request.url).pathname);
  if (!redirect) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(null, {
    status: 302,
    headers: { Location: redirect.location, "Cache-Control": "no-store" },
  });
}

export const config = {
  path: "/r/*",
};
