import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../apps/circuit-lab/app.js', import.meta.url), 'utf8');
const section = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+1)).trim();
const hash = text => createHash('sha256').update(text).digest('hex');

test('restoration preserves the production GLB transforms and accepted wire renderer exactly', () => {
  // Captured from the deployed renderer before this UI repair (2026-09-04).
  assert.equal(hash(section('async function renderAssembly(assembly) {','function renderAssemblyDiagram')), '65dd059dff97093c3806b1ab271a1d5a65533f40b402b954b6ddae1442352ced');
  assert.equal(hash(section('class AcceptedPolylineCurve3','document.querySelectorAll("[data-view]")')), 'ff8d19768d62da081d5cf62ebfabb6012f0ee73780a954c5feb0b26b2f80321e');
  assert.equal(hash(section('function assertExactStoredBuild','function wirelessLabelSprite')), '1365ca1753bb56760d5fde21480311caa5a12945870e0afb0fcb485306371c01');
});

test('the real viewer rejects wrong identity and incomplete saved assemblies before GLB loading', () => {
  const validate = vm.runInNewContext(`(${section('function assertExactStoredBuild','function escapeHtml')})`);
  const good = {id:'build-a',identity:{buildId:'build-a',requestFingerprint:'fingerprint'},manifest:{identity:{buildId:'build-a',requestFingerprint:'fingerprint'},manifestSha256:'saved-hash'},artifactStates:{wiring:{state:'ready'}},artifacts:{assembly:{state:'ready',guideSteps:[{id:'step-1'}]}}};
  assert.doesNotThrow(()=>validate(good,'build-a'));
  assert.throws(()=>validate(good,'build-b'),/identity mismatch/);
  for (const mutate of [b=>{b.manifest.identity.requestFingerprint='other'},b=>{delete b.manifest.manifestSha256},b=>{b.artifacts.assembly.guideSteps=[]},b=>{b.artifactStates.wiring.state='pending'}]) {
    const invalid=structuredClone(good);mutate(invalid);assert.throws(()=>validate(invalid,'build-a'));
  }
});

test('studio acknowledges readiness only after loading and never silently falls back for saved builds', () => {
  assert.match(source,/event.source !== window.parent/);
  assert.match(source,/event.data\?\.buildId !== sourceBuildId/);
  assert.match(source,/await renderAssembly\(build.artifacts.assembly\);[\s\S]*?publishViewerState\("ready"\)/);
  assert.match(source,/if \(!renderer \|\| !controls\) throw new Error/);
  assert.match(source,/publishViewerState\("unavailable"\)/);
  assert.match(source,/generation !== renderGeneration/);
});
