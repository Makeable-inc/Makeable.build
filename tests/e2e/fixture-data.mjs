// The fixed data the browser tests run against. scripts/dev-local.mjs seeds it
// into in-memory storage through tests/e2e/fixtures.mjs; the specs import it
// to know what to expect.
export const TEST_USER = { sub: "local-test-user", name: "Local Test" };
export const SECOND_USER = { sub: "local-test-user-2", name: "Second Tester" };
// Starts no-fixture builds in generation.spec.mjs, so the other users' lists stay fixed.
export const BUILD_USER = { sub: "local-test-user-3", name: "Build Tester" };

// More than one page (24) so the full gallery offers Load more.
export const COMMUNITY_BUILDS = Array.from({ length: 28 }, (_, index) => {
  const n = String(index + 1).padStart(2, "0");
  return { id: `build_e2e-community-${n}_aaaaaaaaaa`, title: `Community fixture ${n}`, ownerSub: `e2e-owner-${n}` };
});

export const TEST_USER_BUILDS = [
  { id: "build_e2e-tester-lamp_bbbbbbbbbb", title: "Tester fixture lamp", ownerSub: TEST_USER.sub },
  { id: "build_e2e-tester-clock_cccccccccc", title: "Tester fixture clock", ownerSub: TEST_USER.sub },
];

export const HIDDEN_BUILD = {
  id: "build_e2e-hidden_dddddddddd",
  title: "Hidden fixture build",
  ownerSub: "e2e-owner-hidden",
  hidden: true,
};

export const PUBLIC_BUILDS = [...TEST_USER_BUILDS, ...COMMUNITY_BUILDS];
export const NEWEST_PUBLIC_BUILD = PUBLIC_BUILDS[0];

// Dashboard access for the test server only (passed as env by playwright.config.mjs).
export const DASHBOARD_ACCESS_KEY = "e2e-dashboard-access-key";
export const DASHBOARD_SESSION_SECRET = "e2e-dashboard-session-secret-at-least-32-chars";

// The build the AI's answers were recorded from (tests/e2e/recordings/desk-thermometer).
export const RECORDED_BUILD = {
  recording: "tests/e2e/recordings/desk-thermometer",
  idea: "A desk thermometer that shows room temperature and humidity on a small OLED screen",
  title: "Amoled Desk Temperature and Humidity Monitor",
  parts: ["Waveshare ESP32-S3-AMOLED-1.91-M", "DHT22 AM2302"],
};

// A second test server for Ember checkout: our real API with dummy Stripe
// keys and a fake Stripe (scripts/dev-local.mjs --fake-stripe). The main test
// server has no Stripe key, like the live AWS site today.
export const PAYMENTS_PORT = 3101;
export const STRIPE_SECRET_KEY = "sk_test_e2e_dummy";
export const STRIPE_WEBHOOK_SECRET = "whsec_e2e_dummy";
