import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWiringReady } from '../apps/landing/app/project-wiring-data.mjs';
import { localWiringBuildFixture } from './fixtures/local-wiring-build.mjs';

test('only complete, internally consistent saved guides unlock Wiring', () => {
  assert.equal(projectWiringReady(localWiringBuildFixture), true);
  for (const mutate of [
    b => { b.artifacts.assembly.guideSteps = []; },
    b => { b.artifacts.assembly.guideSteps = [{}]; },
    b => { b.artifacts.assembly.guideSteps[2].activeWires = ['missing-wire']; },
    b => { b.artifacts.assembly.wires[0].to.partId = 'different-project-part'; },
    b => { b.artifacts.assembly.guideSteps[0].visibleParts = ['missing-part']; },
    b => { b.artifacts.assembly.guideSteps[0].wirelessLinkIds = ['missing-link']; },
    b => { b.artifacts.assembly.guideSteps[1].id = b.artifacts.assembly.guideSteps[0].id; },
    b => { b.artifactStates.wiring.state = 'pending'; },
  ]) {
    const build = structuredClone(localWiringBuildFixture);
    mutate(build);
    assert.equal(projectWiringReady(build), false);
  }
});

test('placement and wireless guides do not require invented physical wires', () => {
  const build = structuredClone(localWiringBuildFixture);
  build.artifacts.assembly.guideSteps = [build.artifacts.assembly.guideSteps[0]];
  build.artifacts.assembly.wires = [];
  assert.equal(projectWiringReady(build), true);
  build.artifacts.assembly.wirelessLinks = [{ id: 'radio', protocol: 'BLE' }];
  build.artifacts.assembly.guideSteps[0].wirelessLinkIds = ['radio'];
  assert.equal(projectWiringReady(build), true);
});
