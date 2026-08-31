const LINKS = new Map([
  ["/r/ig/makeable-build", { platform: "instagram", accountKey: "makeable_build", placement: "bio" }],
  ["/r/ig/makeable-zak", { platform: "instagram", accountKey: "makeable_zak", placement: "bio" }],
  ["/r/fb/makeable", { platform: "facebook", accountKey: "makeable_facebook", placement: "page" }],
  ["/r/tiktok/makeable", { platform: "tiktok", accountKey: "trymakeable_build", placement: "bio" }],
  ["/r/tiktok/trymakeable-build", { platform: "tiktok", accountKey: "trymakeable_build", placement: "bio" }],
  ["/r/youtube/makeable", { platform: "youtube", accountKey: "makeable_youtube", placement: "description" }],
]);

export function socialLinkRedirect(pathname) {
  if (typeof pathname !== "string" || pathname.includes("?") || pathname.includes("#")) return null;
  const normalizedPath = pathname.replace(/\/$/, "");
  const link = LINKS.get(normalizedPath);
  if (link) return redirectFor(link, link.placement);
  for (const [basePath, link] of LINKS) {
    const slug = normalizedPath.slice(`${basePath}/`.length);
    if (!normalizedPath.startsWith(`${basePath}/`) || !postSlug(slug)) continue;
    return redirectFor(link, "post", slug);
  }
  return null;
}

function redirectFor(link, placement, postSlugValue = "") {
  const content = placement === "post"
    ? `${link.accountKey}_post_${postSlugValue}`
    : `${link.accountKey}_${placement}`;
  const query = new URLSearchParams({
    utm_source: link.platform,
    utm_medium: "organic_social",
    utm_campaign: "makeable",
    utm_content: content,
    social_account: link.accountKey,
    social_placement: placement,
  });
  return { platform: link.platform, accountKey: link.accountKey, location: `/?${query}` };
}

function postSlug(value) {
  return /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(value);
}
