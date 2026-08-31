import assert from "node:assert/strict";
import test from "node:test";

import { createLocalBuildWorkshop } from "../lib/local-build-workshop.mjs";

test("local workshop creates a retailer-ready build after its tracked stages finish", async () => {
  let now = 0;
  const workshop = createLocalBuildWorkshop({
    now: () => now,
    durationMs: 1_000,
    createBuild: async ({ idea }) => ({
      status: 201,
      body: {
        id: "local-air-monitor",
        title: "Local Air Monitor",
        idea,
        summary: "A local build preview.",
        image: { url: "/preview.webp", source: "preview_fallback" },
        parts: [{ name: "ESP32", category: "controller", price: 14.99 }],
      },
    }),
  });

  const started = await workshop.start("an air monitor for my desk");
  assert.equal(started.status, 202);
  assert.equal(started.body.job.state, "queued");

  const account = await workshop.handle({ method: "GET", path: "/api/account/builds" });
  assert.equal(account.status, 200);
  assert.equal(account.body.user.name, "Local Maker");

  now = 700;
  assert.equal((await workshop.job(started.body.job.id)).body.job.state, "rendering");

  now = 1_000;
  const claimed = await workshop.claim(started.body.job.id);
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.build.title, "Local Air Monitor");
  assert.equal(claimed.body.build.parts[0].price, 14.99);
});
