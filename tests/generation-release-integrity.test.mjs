import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {builderDisabled,createMemoryBlobStore,createAnonymousBuildJob,claimBuildJobExecution,getBuildJob} from '../lib/build-jobs.mjs';
import {runBackgroundBuildJob} from '../netlify/functions/build-background.mjs';
import {loadProductionBuildPipeline} from '../lib/production-build-pipeline.mjs';

test('production atomic flag permits current generation while legacy flag stays off',()=>{
 assert.equal(builderDisabled({MAKEABLE_BUILD_GENERATION_ENABLED:'0',MAKEABLE_ATOMIC_BUILD_GENERATION_ENABLED:'1'},'worker'),'');
 assert.match(builderDisabled({MAKEABLE_BUILD_GENERATION_ENABLED:'0'},'worker'),/unavailable/);
});
test('a disabled duplicate worker cannot fail an already claimed job',async()=>{
 const stateStore=createMemoryBlobStore();
 const env={MAKEABLE_BUILD_GENERATION_ENABLED:'true'};
 const started=await createAnonymousBuildJob({stateStore,env,request:new Request('https://makeable.build/api/build-jobs'),idea:'Build a USB RGB desk light with a button.'});
 assert.equal(started.ok,true);
 assert.equal(await claimBuildJobExecution(stateStore,started.job.id),true);
 await runBackgroundBuildJob({jobId:started.job.id,stateStore,imageStore:createMemoryBlobStore(),env:{MAKEABLE_BUILD_GENERATION_ENABLED:'0'}});
 assert.equal((await getBuildJob(stateStore,started.job.id)).state,'queued');
});
test('API and worker ship the same production prompt and asset contract',async()=>{
 const pipeline=await loadProductionBuildPipeline();
 assert.equal(pipeline.promptPackageRevision,'2026-09-04.2');
 assert.match(pipeline.catalogRevision,/speech-capture/);
 for(const file of ['api','build-background']){
  const source=await readFile(new URL(`../netlify/functions/${file}.mjs`,import.meta.url),'utf8');
  assert.match(source,/loadProductionBuildPipeline/);
  assert.match(source,/MAKEABLE_ATOMIC_BUILD_GENERATION_ENABLED/);
 }
});

test('regular static releases include the approved GLB renderer and pinned runtime',async()=>{
 const script=await readFile(new URL('../scripts/build-production-static.mjs',import.meta.url),'utf8');
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(pkg.dependencies.three,'0.185.1');
 assert.equal(pkg.dependencies['@google/genai'],'1.30.0');
 for(const token of ['circuit-studio','apps", "circuit-lab','GLTFLoader.js','OrbitControls.js','three.core.js'])assert.ok(script.includes(token),token);
 const viewer=await readFile(new URL('../apps/landing/app/saved-wiring-viewer.tsx',import.meta.url),'utf8');
 assert.match(viewer,/sourceBuildId=\$\{encodeURIComponent\(buildId\)\}/);
 assert.match(viewer,/event\.source !== frame\.current\?\.contentWindow/);
});

test('homepage confirms login before generation and can resume the same saved job',async()=>{
 const source=await readFile(new URL('../apps/landing/app/page.tsx',import.meta.url),'utf8');
 const start=source.slice(source.indexOf('const generateBuildForIdea ='),source.indexOf('const handleGoogleCredential ='));
 assert.ok(start.indexOf('if (!authUserRef.current)')<start.indexOf('fetch(apiUrl("/api/build-jobs")'));
 assert.match(start,/openLogin\("generate"\);\s+return;/);
 assert.match(source,/let account = await fetchAccount\(false\)/);
 for(const event of ['visibilitychange','pageshow','online'])assert.ok(source.includes(`addEventListener("${event}"`));
 assert.match(source,/void resumeBuildJob\(jobId\)/);
});
