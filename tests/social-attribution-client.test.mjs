import assert from "node:assert/strict";
import test from "node:test";
import {
  landingEventKey,
  readSocialAttribution,
  trackSocialLanding,
} from "../apps/landing/app/social-attribution.ts";

const socialUrl = new URL(
  "https://makeable.build/?utm_source=instagram&utm_medium=organic_social&utm_campaign=makeable&utm_content=makeable_zak_bio&social_account=makeable_zak&social_placement=bio",
);

function socialLandingClient(events) {
  return {
    getSessionId() {
      return "session-1";
    },
    registerForSession(attribution) {
      events.push(["register_for_session", attribution.social_account]);
    },
    capture(event) {
      events.push(["capture", event]);
    },
  };
}

test("landing attribution accepts a valid account-specific social URL", () => {
  const attribution = readSocialAttribution(socialUrl);
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

test("social landing capture emits one conversion when session storage is available", () => {
  const events = [];
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const client = socialLandingClient(events);

  trackSocialLanding(socialUrl, client, storage, new Set());
  trackSocialLanding(socialUrl, client, storage, new Set());

  assert.deepEqual(events, [
    ["register_for_session", "makeable_zak"],
    ["capture", "$pageview"],
    ["capture", "social_landing_view"],
    ["register_for_session", "makeable_zak"],
    ["capture", "$pageview"],
  ]);
});

test("social landing capture emits one conversion when session storage throws a DOMException", () => {
  const events = [];
  const storage = {
    getItem() {
      throw new DOMException("Storage disabled", "SecurityError");
    },
    setItem() {
      throw new DOMException("Storage disabled", "SecurityError");
    },
  };
  const fallbackMarkers = new Set();
  const client = socialLandingClient(events);

  trackSocialLanding(socialUrl, client, storage, fallbackMarkers);
  trackSocialLanding(socialUrl, client, storage, fallbackMarkers);

  assert.deepEqual(events, [
    ["register_for_session", "makeable_zak"],
    ["capture", "$pageview"],
    ["capture", "social_landing_view"],
    ["register_for_session", "makeable_zak"],
    ["capture", "$pageview"],
  ]);
  assert.deepEqual([...fallbackMarkers], ["makeable-social-landing:session-1:instagram:makeable_zak:bio"]);
});

test("social landing capture registers before pageview and accesses storage afterward", () => {
  const events = [];
  const storage = {
    getItem() {
      events.push(["storage", "get"]);
      return null;
    },
    setItem() {
      events.push(["storage", "set"]);
    },
  };
  const client = socialLandingClient(events);

  trackSocialLanding(socialUrl, client, storage, new Set());

  assert.deepEqual(events, [
    ["register_for_session", "makeable_zak"],
    ["capture", "$pageview"],
    ["storage", "get"],
    ["capture", "social_landing_view"],
    ["storage", "set"],
  ]);
});
