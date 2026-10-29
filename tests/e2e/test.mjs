// The Playwright `test` every spec uses. It blocks Google's sign-in script for
// every page, so no test depends on Google's network; the test server sets a
// Google client id, so the homepage does try to load it.
import { expect, test as base } from "@playwright/test";

export const GOOGLE_SCRIPT = /^https:\/\/accounts\.google\.com\//;

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(GOOGLE_SCRIPT, (route) => route.abort());
    await use(context);
  },
});

export { expect };
