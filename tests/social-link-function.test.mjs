import assert from "node:assert/strict";
import test from "node:test";

import handler, { config } from "../netlify/functions/social-link.mjs";

test("social link function owns the complete public social-link route", () => {
  assert.equal(config.path, "/r/*");
});

test("social link function redirects valid post identifiers without caching", async () => {
  // Given: a canonical TikTok post redirect request.
  const request = new Request("https://makeable.build/r/tiktok/makeable/7600000000000000001");

  // When: Netlify invokes the redirect function.
  const response = await handler(request);

  // Then: the social campaign keeps its unique post identifier.
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("location"),
    "/?utm_source=tiktok&utm_medium=organic_social&utm_campaign=makeable&utm_content=trymakeable_build_post_7600000000000000001&social_account=trymakeable_build&social_placement=post",
  );
});

test("social link function rejects malformed post identifiers", async () => {
  // Given: a post route with an encoded space instead of a valid identifier.
  const request = new Request("https://makeable.build/r/tiktok/makeable/not%20valid");

  // When: Netlify invokes the redirect function.
  const response = await handler(request);

  // Then: it does not create an attribution redirect.
  assert.equal(response.status, 404);
});
