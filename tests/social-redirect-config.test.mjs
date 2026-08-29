import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Netlify social redirects are explicitly no-store in production", async () => {
  // Given: the production Netlify configuration.
  const config = await readFile(path.join(root, "netlify.toml"), "utf8");

  // When: headers are resolved for each implemented social redirect.
  const headerBlocks = [...config.matchAll(
    /\[\[headers\]\]\s+for = "([^"]+)"\s+\[headers\.values\]\s+Cache-Control = "([^"]+)"/g,
  )].map((match) => ({ path: match[1], cacheControl: match[2] }));

  // Then: every public social link prohibits cached attribution redirects.
  assert.deepEqual(
    headerBlocks.filter(({ path: pathname }) => pathname.startsWith("/r/")),
    [
      { path: "/r/ig/makeable-build", cacheControl: "no-store" },
      { path: "/r/ig/makeable-zak", cacheControl: "no-store" },
      { path: "/r/fb/makeable", cacheControl: "no-store" },
      { path: "/r/tiktok/makeable", cacheControl: "no-store" },
      { path: "/r/youtube/makeable", cacheControl: "no-store" },
    ],
  );
});
