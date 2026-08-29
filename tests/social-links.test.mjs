import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { socialLinkRedirect } from "../lib/social-links.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("social links redirect only the allowlisted social accounts", () => {
  assert.deepEqual(socialLinkRedirect("/r/ig/makeable-build"), {
    platform: "instagram",
    accountKey: "makeable_build",
    location:
      "/?utm_source=instagram&utm_medium=organic_social&utm_campaign=makeable&utm_content=makeable_build_bio&social_account=makeable_build&social_placement=bio",
  });
  assert.deepEqual(socialLinkRedirect("/r/ig/makeable-zak"), {
    platform: "instagram",
    accountKey: "makeable_zak",
    location:
      "/?utm_source=instagram&utm_medium=organic_social&utm_campaign=makeable&utm_content=makeable_zak_bio&social_account=makeable_zak&social_placement=bio",
  });
  assert.deepEqual(socialLinkRedirect("/r/fb/makeable"), {
    platform: "facebook",
    accountKey: "makeable_facebook",
    location:
      "/?utm_source=facebook&utm_medium=organic_social&utm_campaign=makeable&utm_content=makeable_facebook_page&social_account=makeable_facebook&social_placement=page",
  });
  assert.deepEqual(socialLinkRedirect("/r/tiktok/makeable"), {
    platform: "tiktok",
    accountKey: "trymakeable_build",
    location:
      "/?utm_source=tiktok&utm_medium=organic_social&utm_campaign=makeable&utm_content=trymakeable_build_bio&social_account=trymakeable_build&social_placement=bio",
  });
  assert.deepEqual(socialLinkRedirect("/r/youtube/makeable"), {
    platform: "youtube",
    accountKey: "makeable_youtube",
    location:
      "/?utm_source=youtube&utm_medium=organic_social&utm_campaign=makeable&utm_content=makeable_youtube_description&social_account=makeable_youtube&social_placement=description",
  });
  assert.equal(socialLinkRedirect("/r/ig/not-allowlisted"), null);
  assert.equal(socialLinkRedirect("/r/ig/makeable-zak?next=https://evil.example"), null);
  assert.equal(socialLinkRedirect("/r/ig/makeable-zak#next"), null);
});

test("the local server gives GET and HEAD social redirects no response body", async (t) => {
  const server = await startServer(t);

  const getResponse = await fetch(`${server.origin}/r/ig/makeable-build`, { redirect: "manual" });
  assert.equal(getResponse.status, 302);
  assert.equal(
    getResponse.headers.get("location"),
    "/?utm_source=instagram&utm_medium=organic_social&utm_campaign=makeable&utm_content=makeable_build_bio&social_account=makeable_build&social_placement=bio",
  );
  assert.equal(getResponse.headers.get("cache-control"), "no-store");
  assert.equal(await getResponse.text(), "");

  const headResponse = await fetch(`${server.origin}/r/ig/makeable-zak`, {
    method: "HEAD",
    redirect: "manual",
  });
  assert.equal(headResponse.status, 302);
  assert.equal(
    headResponse.headers.get("location"),
    "/?utm_source=instagram&utm_medium=organic_social&utm_campaign=makeable&utm_content=makeable_zak_bio&social_account=makeable_zak&social_placement=bio",
  );
  assert.equal(headResponse.headers.get("cache-control"), "no-store");
  assert.equal(await headResponse.text(), "");

  const unknownResponse = await fetch(`${server.origin}/r/ig/not-allowlisted`, { redirect: "manual" });
  assert.equal(unknownResponse.status, 404);

  const malformedResponse = await fetch(
    `${server.origin}/r/ig/makeable-zak?next=https://evil.example`,
    { redirect: "manual" },
  );
  assert.equal(malformedResponse.status, 404);
});

async function startServer(t) {
  const port = await availablePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });
  const exitPromise = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exitPromise;
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 8_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before starting (${code ?? signal}): ${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("Makeable running at")) return;
      clearTimeout(timeout);
      resolve();
    });
  });
  return { origin: `http://127.0.0.1:${port}` };
}

async function availablePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  probe.close();
  await once(probe, "close");
  return port;
}
