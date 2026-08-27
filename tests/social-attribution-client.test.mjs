import assert from "node:assert/strict";
import test from "node:test";
import {
  landingEventKey,
  readSocialAttribution,
} from "../apps/landing/app/social-attribution.ts";

test("landing attribution accepts a valid account-specific social URL", () => {
  const attribution = readSocialAttribution(new URL(
    "https://makeable.build/?utm_source=instagram&utm_medium=organic_social&utm_campaign=makeable&utm_content=makeable_zak_bio&social_account=makeable_zak&social_placement=bio",
  ));
  assert.deepEqual(attribution, {
    social_platform: "instagram",
    social_account: "makeable_zak",
    social_placement: "bio",
    utm_medium: "organic_social",
    utm_campaign: "makeable",
    utm_content: "makeable_zak_bio",
  });
  assert.equal(
    landingEventKey("session-1", attribution),
    "makeable-social-landing:session-1:instagram:makeable_zak:bio",
  );
});

test("landing attribution rejects partial and unsupported identifiers", () => {
  assert.equal(readSocialAttribution(new URL("https://makeable.build/?social_account=makeable_zak")), null);
  assert.equal(readSocialAttribution(new URL(
    "https://makeable.build/?utm_source=unknown&utm_medium=organic_social&utm_campaign=makeable&utm_content=x&social_account=../../x&social_placement=bio",
  )), null);
});
