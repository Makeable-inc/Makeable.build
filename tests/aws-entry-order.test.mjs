import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

// options.mjs loads secrets into process.env with a top-level await. ES modules
// run in import order, so it must be imported before the app, or app modules
// that read env while loading would see it without secrets.
for (const file of readdirSync(new URL("../aws/functions/", import.meta.url))) {
  if (file === "options.mjs") continue;
  test(`aws/functions/${file} imports options.mjs before anything else`, () => {
    const source = readFileSync(new URL(`../aws/functions/${file}`, import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    assert.equal(imports[0], "./options.mjs");
  });
}
