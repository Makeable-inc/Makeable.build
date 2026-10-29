// Browser tests for the packaged site (release-dist), served by
// scripts/dev-local.mjs with fixed fixture data and in-memory storage. No real
// sign-in, no real data, no requests to Google. Build the site first (npm run build),
// then: npm run test:e2e
//
// The servers run our real API and build pipeline. Outside services are
// replaced (scripts/dev-local-outside.mjs): the AI's answers come from a
// recording of one real build, Stripe is a fake, and any other outside
// request fails. Nothing costs money and no key is needed.
import { defineConfig, devices } from "@playwright/test";

import {
  DASHBOARD_ACCESS_KEY,
  DASHBOARD_SESSION_SECRET,
  PAYMENTS_PORT,
  RECORDED_BUILD,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
} from "./tests/e2e/fixture-data.mjs";

const PORT = 3100;

// No real key and no other AI route, even if a local .env has them. The AI
// replay also swaps in a dummy key of its own, which no request can use.
const NO_REAL_SERVICES = {
  OPENAI_API_KEY: "",
  OPENAI_IMAGE_API_KEY: "",
  OPENAI_BASE_URL: "",
  OPENAI_IMAGE_BASE_URL: "",
  GEMINI_API_KEY: "",
  GOOGLE_GEMINI_BASE_URL: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  // The dashboard's social report reads PostHog when these are set; keep
  // it offline even if a local .env has them.
  POSTHOG_PERSONAL_API_KEY: "",
  POSTHOG_PROJECT_ID: "",
  // Makes the homepage load Google's sign-in script, as on the live site.
  // tests/e2e/test.mjs blocks that script, so no test reaches Google.
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.mjs",
  // Tests share each server's in-memory state; each test gets a fresh browser context.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  outputDir: "./test-results/e2e",
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grepInvert: /@desktop-only/ },
  ],
  webServer: [
    {
      // Replayed AI answers take 1.5 s each, so a build shows its progress.
      command: `node scripts/dev-local.mjs --skip-build --port ${PORT} --fixtures tests/e2e/fixtures.mjs`
        + ` --ai-replay ${RECORDED_BUILD.recording} --ai-replay-delay 1500`,
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...NO_REAL_SERVICES, DASHBOARD_ACCESS_KEY, DASHBOARD_SESSION_SECRET },
    },
    {
      // Ember checkout with a fake Stripe and dummy keys (checkout.spec.mjs).
      command: `node scripts/dev-local.mjs --skip-build --port ${PAYMENTS_PORT} --fake-stripe`,
      url: `http://localhost:${PAYMENTS_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...NO_REAL_SERVICES, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET },
    },
  ],
});
