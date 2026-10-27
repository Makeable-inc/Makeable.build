import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const text = readFileSync(new URL("../samconfig.toml", import.meta.url), "utf8");
const section = (name) => text.split(/^\[/m).find((block) => block.startsWith(`${name}]`)) || "";
const value = (block, key) => block.match(new RegExp(`^${key}\s*=\s*"([^"]*)"`, "m"))?.[1];

test("CI deploys with the same stack and parameters as a manual deploy, without a local profile", () => {
  const manual = section("default.deploy.parameters");
  const ci = section("ci.deploy.parameters");
  assert.ok(ci, "missing [ci.deploy.parameters]");
  assert.equal(value(ci, "parameter_overrides"), value(manual, "parameter_overrides"));
  assert.equal(value(ci, "region"), value(manual, "region"));
  assert.equal(value(section("ci.global.parameters"), "stack_name"), value(section("default.global.parameters"), "stack_name"));
  assert.equal(value(ci, "profile"), undefined);
  assert.match(ci, /^confirm_changeset = false$/m);
});
