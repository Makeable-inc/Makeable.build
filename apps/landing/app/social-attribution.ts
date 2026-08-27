const socialPlatforms = ["instagram", "tiktok", "youtube", "linkedin", "x"] as const;
const socialPlacements = ["bio", "profile", "description", "post"] as const;
const keyPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

type SocialPlatform = (typeof socialPlatforms)[number];
type SocialPlacement = (typeof socialPlacements)[number];

export type SocialAttribution = {
  readonly social_platform: SocialPlatform;
  readonly social_account: string;
  readonly social_placement: SocialPlacement;
  readonly utm_medium: "organic_social";
  readonly utm_campaign: "makeable";
  readonly utm_content: string;
};

function isSocialPlatform(value: string): value is SocialPlatform {
  return socialPlatforms.some((platform) => platform === value);
}

function isSocialPlacement(value: string): value is SocialPlacement {
  return socialPlacements.some((placement) => placement === value);
}

export function readSocialAttribution(url: URL): SocialAttribution | null {
  const value = (key: string): string => url.searchParams.get(key) ?? "";
  const platform = value("utm_source");
  const account = value("social_account");
  const placement = value("social_placement");
  const content = value("utm_content");

  if (!isSocialPlatform(platform) || !isSocialPlacement(placement)) return null;
  if (!keyPattern.test(account) || content !== `${account}_${placement}`) return null;
  if (value("utm_medium") !== "organic_social" || value("utm_campaign") !== "makeable") return null;

  return {
    social_platform: platform,
    social_account: account,
    social_placement: placement,
    utm_medium: "organic_social",
    utm_campaign: "makeable",
    utm_content: content,
  };
}

export function landingEventKey(sessionId: string, attribution: SocialAttribution): string {
  return `makeable-social-landing:${sessionId}:${attribution.social_platform}:${attribution.social_account}:${attribution.social_placement}`;
}
