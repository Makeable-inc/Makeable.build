import assert from "node:assert/strict";
import { test } from "node:test";
import { deployOptions } from "../aws/functions/options.mjs";

const valid = {
  MAKEABLE_DEPLOY_CONTEXT: "staging",
  MAKEABLE_PUBLIC_ORIGIN: "https://staging.makeable.build",
};

test("valid settings are read", () => {
  assert.deepEqual(deployOptions({ ...valid, MAKEABLE_TRUSTED_PROXY_HOPS: "1" }), {
    deployContext: "staging",
    publicOrigin: "https://staging.makeable.build",
    trustedProxyHops: 1,
  });
});

test("a missing or unknown deploy context is refused, so AWS never silently uses prod store names", () => {
  assert.throws(() => deployOptions({ ...valid, MAKEABLE_DEPLOY_CONTEXT: "" }), /MAKEABLE_DEPLOY_CONTEXT/);
  assert.throws(() => deployOptions({ ...valid, MAKEABLE_DEPLOY_CONTEXT: "prod" }), /MAKEABLE_DEPLOY_CONTEXT/);
});

test("a missing or malformed public origin is refused", () => {
  assert.throws(() => deployOptions({ ...valid, MAKEABLE_PUBLIC_ORIGIN: "" }), /MAKEABLE_PUBLIC_ORIGIN/);
  assert.throws(() => deployOptions({ ...valid, MAKEABLE_PUBLIC_ORIGIN: "https://x.com/path" }), /MAKEABLE_PUBLIC_ORIGIN/);
});

test("a bad proxy hop count is refused", () => {
  assert.throws(() => deployOptions({ ...valid, MAKEABLE_TRUSTED_PROXY_HOPS: "-1" }), /MAKEABLE_TRUSTED_PROXY_HOPS/);
  assert.throws(() => deployOptions({ ...valid, MAKEABLE_TRUSTED_PROXY_HOPS: "one" }), /MAKEABLE_TRUSTED_PROXY_HOPS/);
});
