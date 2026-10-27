const DEPLOY_CONTEXTS = new Set(["production", "staging"]);

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
  const hops = String(env.MAKEABLE_TRUSTED_PROXY_HOPS ?? "0");
  if (!/^\d+$/.test(hops)) throw new Error("MAKEABLE_TRUSTED_PROXY_HOPS must be a whole number");
  return { deployContext, publicOrigin, trustedProxyHops: Number(hops) };
}
