import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import handler from "../netlify/functions/api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("community concepts use a beginner-friendly, retailer-aware parts sheet", async () => {
  const [page, productionCss] = await Promise.all([
    readFile(path.join(root, "apps", "landing", "app", "page.tsx"), "utf8"),
    readFile(path.join(root, "apps", "landing", "app", "production.css"), "utf8"),
  ]);

  assert.match(page, /Parts you need/);
  assert.match(page, /every module has its pins already soldered/);
  assert.match(page, /fetch\(apiUrl\(`\/api\/part-prices\?listingIds=/);
  assert.match(page, /Compare retailer prices/);
  assert.match(page, /retailerPartPrice/);
  assert.match(page, /View on Amazon/);
  assert.match(page, /View on AliExpress/);
  assert.match(page, /amazon\.com/);
  assert.match(page, /aliexpress/);
  assert.match(productionCss, /\.mk-detail-part-card/);
  assert.match(productionCss, /\.mk-detail-part-retailers/);
});

test("the public price endpoint rejects arbitrary listing identifiers", async () => {
  const response = await handler(
    new Request("https://makeable.build/api/part-prices?listingIds=arbitrary-retailer-url"),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "One or more listing IDs are not approved.",
  });
});

test("the public price endpoint is read-only", async () => {
  const response = await handler(
    new Request(
      "https://makeable.build/api/part-prices?listingIds=amz-us-xiao-s3-pre-soldered-v1",
      { method: "POST" },
    ),
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});
