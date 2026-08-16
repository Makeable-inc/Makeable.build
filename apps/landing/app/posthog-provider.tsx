"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { EMBER_OFFER_VERSION } from "./analytics";

// A PostHog project token is intentionally public: it can only write events to
// this project. Server-side payment events are still verified by Stripe.
const POSTHOG_PROJECT_TOKEN = "phc_rfcnAWiEY6337gWcv54R8JHBNQ5K2iYy2Hd76ZUM6CJH";

export default function PostHogProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    posthog.init(POSTHOG_PROJECT_TOKEN, {
      api_host: "https://us.i.posthog.com",
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      session_recording: {
        maskAllInputs: true,
      },
    });
    posthog.register({
      product_id: "ember",
      offer_version: EMBER_OFFER_VERSION,
      site: "makeable.build",
    });
  }, []);

  return <>{children}</>;
}
