import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const trackingScript = /<script src="https:\/\/www\.useinflect\.ai\/inflect-tracking\.js"[^>]*data-tracking-key="[^"]+"[^>]*data-inflect-install-version="2026-08-12\.1"><\/script>/g;
const trackingPixel = /<img\b[^>]*src="https:\/\/www\.useinflect\.ai\/api\/bot-traffic\/pixel\?tk=[^&"]+(?:&|&amp;)iv=2026-08-12\.1"[^>]*>/g;

async function htmlFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test("production HTML includes one Tracky script and pixel fallback per page", async () => {
  const files = await htmlFiles(path.join(process.cwd(), "release-dist"));
  assert.ok(files.length > 0, "production build must emit HTML pages");

  for (const file of files) {
    const html = await readFile(file, "utf8");
    assert.equal(html.match(trackingScript)?.length, 1, `${file} must include one Tracky script`);
    assert.equal(html.match(trackingPixel)?.length, 1, `${file} must include one Tracky pixel fallback`);
  }
});
