import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  amplifyCustomHttp,
  amplifyRules,
  parseNetlifyToml,
} from "../scripts/amplify-site-config.mjs";

const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
const API = "https://abc123.lambda-url.us-east-1.on.aws";


function rules() {
  return amplifyRules({ netlify: parseNetlifyToml(toml), apiOrigin: API });
}

test("netlify.toml redirects are read in order with their status", () => {
  const { redirects } = parseNetlifyToml(toml);
  assert.equal(redirects.length, 10);
  assert.deepEqual(redirects[0], { from: "/pilot", to: "/pilot-app.html", status: "200" });
  assert.deepEqual(redirects.at(-1), {
    from: "/ember/download",
    to: "https://github.com/Makeable-inc/Makeable.build/releases/download/ember-v2.0.0/Claude-Burner-2.0.0-arm64.dmg",
    status: "302",
  });
});

test("Netlify redirects come first, unchanged", () => {
  const { redirects } = parseNetlifyToml(toml);
  assert.deepEqual(
    rules().slice(0, 10).map(({ source, target, status }) => ({ from: source, to: target, status })),
    redirects,
  );
});

test("/api/* and /config.local.js are proxied to the API Lambda", () => {
  const all = rules();
  assert.deepEqual(all.find((rule) => rule.source === "/api/<*>"), {
    source: "/api/<*>",
    target: `${API}/api/<*>`,
    status: "200",
  });
  assert.deepEqual(all.find((rule) => rule.source === "/config.local.js"), {
    source: "/config.local.js",
    target: `${API}/config.local.js`,
    status: "200",
  });
});

test("folder pages get no extra rule, so Amplify adds the trailing slash like Netlify (/app → /app/)", () => {
  const all = rules();
  for (const dir of ["app", "circuit-studio", "privacy", "terms"]) {
    assert.equal(all.find((rule) => rule.source === `/${dir}`), undefined, dir);
  }
});

// Measured on Amplify 27 Oct: "404" redirects (302) to /404.html, no rule gives a
// blank 404, "404-200" serves /404.html in place with status 404 like Netlify.
test("unknown paths are answered 404 with the site's 404 page, in place, as the last rule", () => {
  assert.deepEqual(rules().at(-1), { source: "/<*>", target: "/404.html", status: "404-200" });
});

test("every netlify.toml header becomes an Amplify custom header with the same value", () => {
  const yaml = amplifyCustomHttp(parseNetlifyToml(toml));
  assert.match(yaml, /^customHeaders:\n/);
  const { headers } = parseNetlifyToml(toml);
  assert.equal(headers.length, 13);
  for (const block of headers) {
    for (const [key, value] of Object.entries(block.values)) {
      assert.ok(yaml.includes(`key: ${JSON.stringify(key)}\n        value: ${JSON.stringify(value)}`), `${block.for} ${key}`);
    }
  }
});

test("Netlify path patterns become Amplify globs", () => {
  const yaml = amplifyCustomHttp(parseNetlifyToml(toml));
  for (const pattern of ["**", "/ember/**", "/_next/static/**", "/dashboard", "/dashboard/**", "/hologram/sw.js", "/r/fb/makeable"]) {
    assert.ok(yaml.includes(`- pattern: ${JSON.stringify(pattern)}\n`), pattern);
  }
});

test("every /r/* path goes to the API Lambda after the netlify.toml short links", () => {
  const all = rules();
  const proxy = all.findIndex((rule) => rule.source === "/r/<*>");
  assert.deepEqual(all[proxy], { source: "/r/<*>", target: `${API}/r/<*>`, status: "200" });
  assert.ok(proxy > all.findIndex((rule) => rule.source === "/r/ig/makeable-build"));
});
