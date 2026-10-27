// Settings every Lambda entry shares, set on the function by the infra stack.
export const deployContext = process.env.MAKEABLE_DEPLOY_CONTEXT || "";
export const trustedProxyHops = Number(process.env.MAKEABLE_TRUSTED_PROXY_HOPS || 0);
