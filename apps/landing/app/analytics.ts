"use client";

import posthog from "posthog-js";

export const EMBER_OFFER_VERSION = "ember_usd_3499_free_shipping_oct_2026_v1";

type AnalyticsValue = boolean | number | string | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

export function captureMakeableEvent(event: string, properties: AnalyticsProperties = {}) {
  posthog.capture(event, {
    product_id: "ember",
    offer_version: EMBER_OFFER_VERSION,
    ...properties,
  });
}

export function makeableDistinctId() {
  return posthog.get_distinct_id();
}

export function identifyMakeableAccount(analyticsId: string) {
  if (!/^makeable_account_[a-f0-9]{40}$/.test(analyticsId)) return;
  posthog.identify(analyticsId);
}

// After log out, events must not keep counting toward the previous account.
export function resetMakeableAnalytics() {
  posthog.reset();
}

// A session that ended without log out (expired, or refused by the server) must
// not keep counting this browser's events toward that account. Anonymous
// visitors keep their id.
export function forgetEndedMakeableAccount() {
  if (posthog.get_property("$user_state") === "identified") posthog.reset();
}

export function makeableReferringDomain() {
  if (typeof document === "undefined" || !document.referrer) return "$direct";
  try {
    const referrer = new URL(document.referrer);
    return referrer.hostname === window.location.hostname
      ? "$direct"
      : referrer.hostname.toLowerCase();
  } catch {
    return "$direct";
  }
}
