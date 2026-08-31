import assert from "node:assert/strict";
import test from "node:test";

import { buildLibrary } from "../apps/landing/app/app/build-library.ts";

test("signed-in workspaces list only the owner's saved builds", () => {
  const accountBuilds = [{ id: "mine" }];
  const publicBuilds = [{ id: "theirs" }];

  assert.deepEqual(buildLibrary(accountBuilds, publicBuilds, true), accountBuilds);
  assert.deepEqual(buildLibrary(accountBuilds, publicBuilds, false), publicBuilds);
});
