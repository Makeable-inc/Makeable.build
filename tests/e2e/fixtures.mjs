// Seeds the fixed browser-test data into dev-local's in-memory storage.
// Loaded by: node scripts/dev-local.mjs --fixtures tests/e2e/fixtures.mjs
import { Jimp, JimpMime } from "jimp";

import {
  buildCommunityStoreName,
  buildJobImageStoreName,
  buildJobQuotaStoreName,
  buildJobStateStoreName,
  createRoutedBuildStateStore,
} from "../../lib/build-jobs.mjs";
import { openStore } from "../../lib/storage/index.mjs";
import { HIDDEN_BUILD, PUBLIC_BUILDS } from "./fixture-data.mjs";

export default async function seed({ deployContext }) {
  const open = (name) => openStore({ name, consistency: "strong" });
  const stateStore = createRoutedBuildStateStore({
    jobStore: open(buildJobStateStoreName(deployContext)),
    quotaStore: open(buildJobQuotaStoreName(deployContext)),
    communityStore: open(buildCommunityStoreName(deployContext)),
  });
  const images = open(buildJobImageStoreName(deployContext));

  // Newest first in the gallery: the first build gets the latest time. Times
  // are before the atomic-manifest cutover so the records count as usable.
  const all = [...PUBLIC_BUILDS, HIDDEN_BUILD];
  for (const [index, build] of all.entries()) {
    const at = new Date(Date.UTC(2026, 7, 1, 12, 0) - index * 60_000).toISOString();
    await stateStore.setJSON(`gallery/${build.id}.json`, {
      id: build.id,
      title: build.title,
      summary: `Fixture build for the browser tests: ${build.title}.`,
      createdAt: at,
      claimedAt: at,
      ownerSub: build.ownerSub,
      makerName: "Fixture Maker",
      publishState: build.hidden ? "hidden" : "public",
      ...(build.hidden ? { hiddenAt: at } : {}),
      parts: [],
      image: { url: `/api/builds/${build.id}/image`, source: "openai", status: "generated" },
    });
    const color = (((index * 47) % 200) + 40) * 0x1000000 + (((index * 91) % 200) + 40) * 0x10000 + 0x80ff;
    const png = await new Jimp({ width: 120, height: 80, color }).getBuffer(JimpMime.png);
    await images.set(`gallery-images/${build.id}`, new Blob([png], { type: "image/png" }), {
      metadata: { contentType: "image/png" },
    });
  }
}
