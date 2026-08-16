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
