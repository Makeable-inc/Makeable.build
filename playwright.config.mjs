// Browser tests for the packaged site (release-dist), served by
// scripts/dev-local.mjs with fixed fixture data and in-memory storage. No real
// sign-in, no OpenAI calls, no real data, no requests to Google. Build the site first (npm run build),
// then: npm run test:e2e
import { defineConfig, devices } from "@playwright/test";

import { DASHBOARD_ACCESS_KEY, DASHBOARD_SESSION_SECRET } from "./tests/e2e/fixture-data.mjs";

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.mjs",
  // One server with shared in-memory state; each test gets a fresh browser context.
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
  webServer: {
    command: `node scripts/dev-local.mjs --skip-build --port ${PORT} --fixtures tests/e2e/fixtures.mjs`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DASHBOARD_ACCESS_KEY,
      DASHBOARD_SESSION_SECRET,
      // Builds are never started by these tests; make sure none could call OpenAI.
      OPENAI_API_KEY: "",
      // Makes the homepage load Google's sign-in script, as on the live site.
      // tests/e2e/test.mjs blocks that script, so no test reaches Google.
      GOOGLE_CLIENT_ID: "e2e-google-client-id",
    },
  },
});
