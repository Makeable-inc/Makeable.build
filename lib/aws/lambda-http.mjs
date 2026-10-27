const CLIENT_IP_HEADERS = ["x-nf-client-connection-ip", "cf-connecting-ip", "x-real-ip"];

// Runs a Netlify-style handler, (Request, context) => Response, behind a
// Lambda Function URL (payload format 2.0).
//
// trustedProxyHops: how many proxies we run in front of the Lambda (e.g. 1 for
// Amplify). Each appends to x-forwarded-for, so the client is that many
// entries from the right; anything further left was typed by the visitor.
//
// publicOrigin: the site's address (e.g. https://makeable.build). Behind a proxy
// the Function URL sees its own host, which would fail the app's Origin checks.
export function toLambdaHandler(
  handler,
  { deployContext = "", trustedProxyHops = 0, publicOrigin = "", logClientIp = false } = {},
) {
  return (event) =>
    runWithContext(deployContext, async (context) =>
      toLambdaResult(await handler(toRequest(event, trustedProxyHops, publicOrigin, logClientIp), context)),
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

// Runs the build pipeline from an async Lambda invoke. Rebuilds the signed
// request Netlify would have sent, so the handler's signature check still applies.
export function toBackgroundEventHandler(handler, { deployContext = "" } = {}) {
  return (event) =>
    runWithContext(deployContext, async (context) => {
      const request = new Request("https://background.invalid/.netlify/functions/build-background", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Makeable-Background-Timestamp": String(event?.timestamp || ""),
          "X-Makeable-Background-Signature": String(event?.signature || ""),
        },
        body: JSON.stringify({ jobId: event?.jobId }),
      });
      const response = await handler(request, context);
      return { statusCode: response.status };
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

function toRequest(event, trustedProxyHops, publicOrigin, logClientIp = false) {
  const method = event.requestContext.http.method;
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const origin = publicOrigin || `https://${event.headers.host}`;
  const url = `${origin}${event.rawPath}${query}`;
  const headers = new Headers(event.headers);
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));
  // The app trusts x-nf-client-connection-ip for rate limits; Netlify always
  // overwrote it, so we must too.
  for (const name of CLIENT_IP_HEADERS) headers.delete(name);
  const clientIp = trustedClientIp(event, trustedProxyHops);
  headers.set("x-nf-client-connection-ip", clientIp);
  // Temporary switch for choosing trustedProxyHops from real traffic.
  if (logClientIp) {
    console.log(JSON.stringify({
      type: "client_ip_debug",
      sourceIp: event.requestContext.http.sourceIp,
      xForwardedFor: event.headers["x-forwarded-for"] || "",
      trustedProxyHops,
      chosen: clientIp,
    }));
  }
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
