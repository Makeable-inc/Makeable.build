// Turns netlify.toml (redirects, headers) into
// Amplify Hosting rules, so the site behaves on Amplify as it does on Netlify.

// Reads the [[redirects]] and [[headers]] blocks; nothing else in the file.
export function parseNetlifyToml(text) {
  const redirects = [];
  const headers = [];
  for (const block of text.split(/^\[\[/m).slice(1)) {
    const field = (name) => block.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, "m"))?.[1];
    if (block.startsWith("redirects]]")) {
      redirects.push({
        from: field("from"),
        to: field("to"),
        status: block.match(/^\s*status\s*=\s*(\d+)/m)?.[1] || "301",
      });
    } else if (block.startsWith("headers]]")) {
      const values = {};
      const valuesText = block.split(/^\s*\[headers\.values\]/m)[1] || "";
      for (const [, key, value] of valuesText.matchAll(/^\s*([A-Za-z0-9-]+)\s*=\s*"(.*)"\s*$/gm)) {
        values[key] = value;
      }
      headers.push({ for: field("for"), values });
    }
  }
  return { redirects, headers };
}

// Amplify uses the first matching rule, so the order here is the routing order.
export function amplifyRules({ netlify, apiOrigin }) {
  const rule = (source, target, status) => ({ source, target, status });
  const rules = netlify.redirects.map(({ from, to, status }) => rule(from, to, status));

  // The rest of /r/* (other accounts, per-post links, trailing slashes) ran in a
  // Netlify function; the API Lambda serves it with the same code.
  const api = apiOrigin.replace(/\/$/, "");
  rules.push(rule("/r/<*>", `${api}/r/<*>`, "200"));
  rules.push(rule("/api/<*>", `${api}/api/<*>`, "200"));
  rules.push(rule("/config.local.js", `${api}/config.local.js`, "200"));

  // No rules for folder pages: Amplify redirects /app to /app/, as Netlify does.
  // "404-200" serves /404.html in place with status 404; plain "404" redirects to it.
  rules.push(rule("/<*>", "/404.html", "404-200"));
  return rules;
}

// customHttp.yml for the uploaded site. Values are JSON strings, which YAML reads as-is.
export function amplifyCustomHttp(netlify) {
  const lines = ["customHeaders:"];
  for (const block of netlify.headers) {
    for (const pattern of amplifyPatterns(block.for)) {
      lines.push(`  - pattern: ${JSON.stringify(pattern)}`, "    headers:");
      for (const [key, value] of Object.entries(block.values)) {
        lines.push(`      - key: ${JSON.stringify(key)}`, `        value: ${JSON.stringify(value)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

// Netlify's * matches across slashes; Amplify globs need ** for that.
function amplifyPatterns(netlifyPath) {
  if (netlifyPath === "/*") return ["**"];
  if (netlifyPath.endsWith("/*")) return [`${netlifyPath.slice(0, -1)}**`];
  if (netlifyPath.endsWith("*")) {
    const base = netlifyPath.slice(0, -1);
    return [base, `${base}/**`];
  }
  return [netlifyPath];
}
