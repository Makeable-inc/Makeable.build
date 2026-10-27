import { loadSecretsIntoEnv } from "../../lib/aws/secrets.mjs";

// Runs once per cold start, before any entry reads its settings.
await loadSecretsIntoEnv();

const DEPLOY_CONTEXTS = new Set(["production", "staging"]);
// Off Netlify, lib/build-jobs.mjs draftCookieSecret() falls back to a dev
// secret that is public in this repo, so these must be set for real.
const REQUIRED_SECRETS = ["MAKEABLE_DRAFT_COOKIE_SECRET", "MAKEABLE_BACKGROUND_SECRET"];

// Settings every Lambda entry shares, set on the function by the infra stack.
// Refuses to start on a missing value: store names fall back to production
// when the deploy context is empty, which must never happen by accident.
export function deployOptions(env = process.env) {
  const deployContext = env.MAKEABLE_DEPLOY_CONTEXT || "";
  if (!DEPLOY_CONTEXTS.has(deployContext)) {
    throw new Error(`MAKEABLE_DEPLOY_CONTEXT must be one of ${[...DEPLOY_CONTEXTS].join(", ")}`);
  }
  const publicOrigin = env.MAKEABLE_PUBLIC_ORIGIN || "";
  if (!/^https:\/\/[^/]+$/.test(publicOrigin)) {
    throw new Error("MAKEABLE_PUBLIC_ORIGIN must be an https origin, e.g. https://makeable.build");
  }
  for (const name of REQUIRED_SECRETS) {
    if (String(env[name] || "").length < 32) throw new Error(`${name} must be set (32+ characters)`);
  }
  const hops = String(env.MAKEABLE_TRUSTED_PROXY_HOPS ?? "0");
  if (!/^\d+$/.test(hops)) throw new Error("MAKEABLE_TRUSTED_PROXY_HOPS must be a whole number");
  return { deployContext, publicOrigin, trustedProxyHops: Number(hops) };
}
