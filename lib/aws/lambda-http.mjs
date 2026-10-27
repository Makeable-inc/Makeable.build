const CLIENT_IP_HEADERS = ["x-nf-client-connection-ip", "cf-connecting-ip", "x-real-ip"];

// Runs a Netlify-style handler, (Request, context) => Response, behind a
// Lambda Function URL (payload format 2.0).
//
// trustedProxyHops: how many proxies we run in front of the Lambda (e.g. 1 for
// Amplify). Each appends to x-forwarded-for, so the client is that many
// entries from the right; anything further left was typed by the visitor.
export function toLambdaHandler(handler, { deployContext = "", trustedProxyHops = 0 } = {}) {
  return (event) =>
    runWithContext(deployContext, async (context) =>
      toLambdaResult(await handler(toRequest(event, trustedProxyHops), context)),
    );
}

// Runs a scheduled Netlify function (cleanup, social refresh) from an
// EventBridge schedule.
export function toScheduledHandler(handler, { deployContext = "" } = {}) {
  return () =>
    runWithContext(deployContext, async (context) => {
      const response = await handler(new Request("https://scheduled.invalid/", { method: "POST" }), context);
      return { statusCode: response?.status ?? 200 };
    });
}

async function runWithContext(deployContext, run) {
  // Lambda freezes once it returns, so background work must finish first.
  const pending = [];
  const context = {
    deploy: { context: deployContext },
    waitUntil: (promise) => pending.push(promise),
  };
  const result = await run(context);
  for (const outcome of await Promise.allSettled(pending)) {
    if (outcome.status === "rejected") console.error("waitUntil task failed", outcome.reason);
  }
  return result;
}

function trustedClientIp(event, trustedProxyHops) {
  const sourceIp = event.requestContext.http.sourceIp;
  if (trustedProxyHops === 0) return sourceIp;
  const forwarded = String(event.headers["x-forwarded-for"] || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return forwarded[forwarded.length - trustedProxyHops] || sourceIp;
}

function toRequest(event, trustedProxyHops) {
  const method = event.requestContext.http.method;
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `https://${event.headers.host}${event.rawPath}${query}`;
  const headers = new Headers(event.headers);
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));
  // The app trusts x-nf-client-connection-ip for rate limits; Netlify always
  // overwrote it, so we must too.
  for (const name of CLIENT_IP_HEADERS) headers.delete(name);
  headers.set("x-nf-client-connection-ip", trustedClientIp(event, trustedProxyHops));
  const hasBody = event.body != null && method !== "GET" && method !== "HEAD";
  const body = hasBody ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8") : undefined;
  return new Request(url, { method, headers, body });
}

async function toLambdaResult(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") headers[key] = value;
  });
  const result = {
    statusCode: response.status,
    headers,
    cookies: response.headers.getSetCookie(),
  };
  if (isTextType(headers["content-type"])) {
    return { ...result, body: await response.text() };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { ...result, body: bytes.toString("base64"), isBase64Encoded: true };
}

function isTextType(contentType = "") {
  return /^text\/|json|javascript|xml|x-www-form-urlencoded/i.test(contentType);
}
