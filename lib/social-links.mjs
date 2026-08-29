const LINKS = new Map([
  ["/r/ig/makeable-build", { platform: "instagram", accountKey: "makeable_build", placement: "bio" }],
  ["/r/ig/makeable-zak", { platform: "instagram", accountKey: "makeable_zak", placement: "bio" }],
  ["/r/fb/makeable", { platform: "facebook", accountKey: "makeable_facebook", placement: "page" }],
]);

export function socialLinkRedirect(pathname) {
  if (typeof pathname !== "string" || pathname.includes("?") || pathname.includes("#")) return null;
  const link = LINKS.get(pathname.replace(/\/$/, ""));
  if (!link) return null;
  const query = new URLSearchParams({
    utm_source: link.platform,
    utm_medium: "organic_social",
    utm_campaign: "makeable",
    utm_content: `${link.accountKey}_${link.placement}`,
    social_account: link.accountKey,
    social_placement: link.placement,
  });
  return { platform: link.platform, accountKey: link.accountKey, location: `/?${query}` };
}
