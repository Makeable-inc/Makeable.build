import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { projectRetailerLink } from "../apps/landing/app/project-retailer-links.mjs";
import { partPlainLabel } from "../apps/landing/app/project-part-copy.mjs";

test("physical output modules are not all labelled status lights", () => {
  assert.equal(partPlainLabel({name:"Vibration motor module",category:"output"}), "Vibration motor");
  assert.equal(partPlainLabel({name:"RGB LED module",category:"output"}), "Status light");
});

test("saved Amazon and AliExpress listings are preserved independently", () => {
  const part = { name: "ESP32-S3 N8R2", url: "https://www.amazon.com/dp/B0BVVGNBB3", aliexpressUrl: "https://www.aliexpress.com/item/1005001234567.html" };
  assert.deepEqual(projectRetailerLink(part, "amazon"), { href: part.url, isSearch: false });
  assert.deepEqual(projectRetailerLink(part, "aliexpress"), { href: part.aliexpressUrl, isSearch: false });
});
test("missing AliExpress listing yields an explicitly labelled search for the exact part name", () => {
  const link = projectRetailerLink({ name: "ESP32-S3 N8R2 & carrier", url: "https://www.amazon.com/dp/B0BVVGNBB3" }, "aliexpress");
  assert.equal(link.isSearch, true);
  assert.equal(link.href, "https://www.aliexpress.com/w/wholesale-ESP32-S3%20N8R2%20%26%20carrier.html");
});
test("saved search links stay searches and unsafe or wrong-retailer URLs never become purchase links", () => {
  for (const url of ["javascript:alert(1)", "https://aliexpress.com.evil.test/item/123.html", "https://user:pass@www.aliexpress.com/item/123.html", "not-a-url"]) {
    assert.equal(projectRetailerLink({ name: "Rotary encoder", aliexpressUrl: url }, "aliexpress").isSearch, true);
    assert.equal(new URL(projectRetailerLink({ name: "Rotary encoder", aliexpressUrl: url }, "aliexpress").href).hostname, "www.aliexpress.com");
  }
  assert.equal(projectRetailerLink({ name: "Encoder", aliexpressUrl: "https://www.aliexpress.us/w/wholesale-encoder.html" }, "aliexpress").isSearch, true);
  assert.equal(projectRetailerLink({ name: "Encoder", url: "https://www.aliexpress.com/item/123.html" }, "amazon").isSearch, true);
});
test("both named retailer actions render without fabricated cross-retailer prices", async () => {
  const source = await readFile(new URL("../apps/landing/app/project-overview.tsx", import.meta.url), "utf8");
  assert.match(source, /<RetailerCard retailer="amazon"/);
  assert.match(source, /<RetailerCard retailer="aliexpress"/);
  assert.match(source, /Search links are not verified matches/);
  assert.match(source, /isSearch \? "Search" : "View listing"/);
  assert.doesNotMatch(source, /Shop ↗|retailer="aliexpress" price=/);
});
