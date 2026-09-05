import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { compileElectricalGraph } from "../lib/prompt2circuit-electrical-compiler.mjs";
import { verifiedPartsCatalog } from "../lib/makeable-builds.mjs";
import {
  inferredProductDeviceCount,
  loadProductionBuildPipeline,
  normalizeProductionProfileContracts,
} from "../lib/production-build-pipeline.mjs";
import { createPrompt2CircuitArtifacts, requestSolAssemblyPresentation } from "../lib/prompt2circuit-production.mjs";

const releaseRoot = new URL(
  "../artifacts/aws-assembly-release/prompt2circuit-production-ready79-speech-capture-20260904-v1/",
  import.meta.url,
);
const releaseProfiles = JSON.parse(
  await readFile(new URL("profiles.json", releaseRoot), "utf8"),
).profiles;
const releaseManifest = JSON.parse(
  await readFile(new URL("manifest.json", releaseRoot), "utf8"),
);

test("presentation style recovery preserves the exact AWS models, physical routes and guide", async () => {
  const pipeline=await loadProductionBuildPipeline();
  const selected=pipeline.createOptions({env:{}}).finalizeSelectedParts(
    verifiedPartsCatalog().filter(p=>["b0bpg115t1-46","b0bxkmgsg6-52"].includes(p.id)),
    {idea:"An RGB LED lamp with a touch pad"},
  );
  const options={parts:selected,profiles:normalizeProductionProfileContracts(releaseProfiles),manifest:releaseManifest,validateRemoteAssets:false};
  const baseline=await createPrompt2CircuitArtifacts(options);
  const events=[];
  const planner=({placement})=>({contractFingerprint:placement.fingerprint,acknowledgedPartIds:placement.parts.map(p=>p.id),assemblySteps:[{title:"Connect the parts",beginnerInstruction:"Keep power disconnected."}],routingPresentation:{wireDiameterMm:1.2,minimumBendRadiusMm:3,style:"natural arch; no coil or rectangular route",loopsAllowed:false}});
  const recovered=await createPrompt2CircuitArtifacts({...options,presentationPlanner:planner,onEvent:async(name,details)=>events.push({name,...details})});
  assert.deepEqual(recovered.assembly.parts,baseline.assembly.parts);
  assert.deepEqual(recovered.assembly.wires,baseline.assembly.wires);
  assert.deepEqual(recovered.assembly.guideSteps,baseline.assembly.guideSteps);
  assert.ok(recovered.assembly.parts.some(p=>p.assetId.includes("touch")));
  assert.ok(events.some(e=>e.name==="wiring_presentation_recovered" && e.rejectedStyle.includes("no coil")));
  for(const override of [
    {contractFingerprint:"wrong"},
    {routingPresentation:{style:"short-open-natural-arch",loopsAllowed:true}},
    {assemblySteps:[{title:"Do not assemble",beginnerInstruction:"Blocked"}]},
  ]) await assert.rejects(createPrompt2CircuitArtifacts({...options,presentationPlanner:args=>({...planner(args),...override})}),/sol_/);
});

test("a mismatched prose part list cannot stop a valid compiled circuit or alter AWS wiring", async () => {
  const pipeline = await loadProductionBuildPipeline();
  const selected = pipeline.createOptions({env:{}}).finalizeSelectedParts([], {
    idea: "A desk buddy with an I2S microphone sending audio to a cloud API",
  });
  const options = {parts:selected, profiles:normalizeProductionProfileContracts(releaseProfiles), manifest:releaseManifest, validateRemoteAssets:false};
  const baseline = await createPrompt2CircuitArtifacts(options);
  const planner = ({placement}) => ({
    contractFingerprint:placement.fingerprint,
    acknowledgedPartIds:["wrong-catalog-id"],
    assemblySteps:[{title:"Untrusted generated prose",beginnerInstruction:"Place the boards."}],
    routingPresentation:{style:"short-open-natural-arch",loopsAllowed:false},
  });
  for (const ids of [["wrong-catalog-id"], [], null, ["duplicate", "duplicate"]]) {
    const events = [];
    const recovered = await createPrompt2CircuitArtifacts({...options,
      presentationPlanner:args=>({...planner(args),acknowledgedPartIds:ids}),
      onEvent:async(name,details)=>events.push({name,...details}),
    });
    assert.deepEqual(recovered, baseline, "recovery must equal the independently generated deterministic artifact");
    const recovery = events.find(e=>e.recovery === "discard-mismatched-presentation");
    assert.equal(recovery.reason, "sol_part_set_not_acknowledged");
    assert.equal(recovery.expectedPartIds.length, baseline.assembly.parts.length);
  }
  for (const override of [
    {contractFingerprint:"another-project"},
    {assemblySteps:[]},
    {assemblySteps:[{title:"Do not assemble",beginnerInstruction:"Blocked"}]},
    {routingPresentation:{style:"short-open-natural-arch",loopsAllowed:true}},
  ]) await assert.rejects(createPrompt2CircuitArtifacts({...options,presentationPlanner:args=>({...planner(args),...override})}),/sol_/);
  await assert.rejects(createPrompt2CircuitArtifacts({...options,validateRemoteAssets:true,
    presentationPlanner:planner,fetchFn:async()=>new Response("wrong GLB bytes"),
  }),/aws_glb_sha_mismatch/);
});

test("presentation response schema binds model acknowledgement to exact instance IDs", async () => {
  const placement = {fingerprint:"exact-fingerprint",parts:[{id:"controller-1"},{id:"mic-1"}],routes:[]};
  await requestSolAssemblyPresentation({env:{OPENAI_API_KEY:"test-only"},placement,graph:{connections:[]},resolved:{selectedCatalogPartIds:["catalog-id"]},
    fetchFn:async(_url,options)=>{
      const schema=JSON.parse(options.body).text.format.schema.properties;
      assert.deepEqual(schema.contractFingerprint.enum,[placement.fingerprint]);
      assert.deepEqual(schema.acknowledgedPartIds.items.enum,["controller-1","mic-1"]);
      assert.equal(schema.acknowledgedPartIds.minItems,2);
      assert.equal(schema.acknowledgedPartIds.maxItems,2);
      return Response.json({output_text:JSON.stringify({assemblySteps:[]})});
    },
  });
});

test("the website pipeline stays pinned to the focused speech-capture release", async () => {
  const pipeline = await loadProductionBuildPipeline();
  assert.equal(pipeline.catalogRevision, "prompt2circuit-production-ready79-speech-capture-20260904-v1");
  assert.equal(pipeline.promptPackageRevision, "2026-09-04.2");
  assert.equal(pipeline.compilerPatchRevision, "bme280-straps-xiao-s3-contact-frame-v2");
  assert.equal(pipeline.semanticPatchRevision, "touch-intent-negation-and-presentation-v6");
  const selected = pipeline.createOptions({ env: {} }).finalizeSelectedParts([], {
    idea: "a desktop temperature display",
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].category, "controller");
  assert.equal(selected[0].assemblyAssets[0].partId, "esp32-s3-devkitc-1-n8r2");
  assert.equal(pipeline.createOptions({ env: {} }).enforceProjectCopyQuality, true);
});

test("paired partner experiences deterministically require two complete devices", () => {
  assert.equal(inferredProductDeviceCount("I want to make a couple emotion desk buddy for me and my partner"), 2);
  assert.equal(inferredProductDeviceCount("Put one mood messenger on each desk"), 2);
  assert.equal(inferredProductDeviceCount("Use a couple of temperature sensors in one station"), 1);
});

test("a cloud transcription build selects the exact I2S microphone and produces six real guide wires", async () => {
  const pipeline = await loadProductionBuildPipeline();
  const idea = "Build a desktop meeting transcription device with an I2S microphone that sends audio over Wi-Fi to an external transcription API";
  const microphone = verifiedPartsCatalog().find((part) => part.id === "b0h4sfmvw1-70");
  assert.ok(microphone);

  const selected = pipeline.createOptions({ env: {} }).finalizeSelectedParts([microphone], { idea });
  assert.deepEqual(selected.map((part) => part.id), ["b0bvvgnbb3-112", "b0h4sfmvw1-70"]);

  const recoveredFromPlannerOmission = pipeline.createOptions({ env: {} }).finalizeSelectedParts([], { idea });
  assert.deepEqual(recoveredFromPlannerOmission.map((part) => part.id), ["b0bvvgnbb3-112", "b0h4sfmvw1-70"]);

  const artifacts = await createPrompt2CircuitArtifacts({
    parts: selected,
    profiles: normalizeProductionProfileContracts(releaseProfiles),
    manifest: releaseManifest,
    validateRemoteAssets: false,
  });
  const microphoneAssetId = "omnidirectional-microphone-module-with-pre-soldered-pins-for-quick-insta-b0h4sfmvw1";
  assert.ok(artifacts.assembly.parts.some((part) => part.assetId === microphoneAssetId));
  assert.deepEqual(artifacts.assembly.wires.map((wire) => wire.signal).sort(), [
    "3V3", "GND", "GND", "I2S_SCK", "I2S_SD", "I2S_WS",
  ]);
  assert.equal(artifacts.assembly.electricalGraph.invariants.requiredSignalStrapsResolved, true);
  assert.equal(artifacts.assembly.electricalGraph.invariants.operatingModesResolved, true);
});

test("paired desk buddies use two self-contained displays and compile an ESP-NOW link", async () => {
  const pipeline = await loadProductionBuildPipeline();
  const idea = "I want to make a couple emotion desk buddy for me and my partner";
  const selected = pipeline.createOptions({ env: {} }).finalizeSelectedParts([], { idea });
  assert.equal(selected.length, 2);
  assert.deepEqual(selected.map((part) => part.id), ["b0f99kmrvl-39", "b0f99kmrvl-39"]);
  assert.ok(selected.every((part) => part.assemblyAssets?.[0]?.partId === (
    "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header"
  )));

  const artifacts = await createPrompt2CircuitArtifacts({
    parts: selected,
    profiles: normalizeProductionProfileContracts(releaseProfiles),
    manifest: releaseManifest,
    validateRemoteAssets: false,
  });
  assert.equal(artifacts.assembly.parts.length, 2);
  assert.equal(artifacts.assembly.networkNodes.length, 2);
  assert.equal(artifacts.assembly.wirelessLinks.length, 1);
  assert.equal(artifacts.assembly.wirelessLinks[0].protocol, "ESP-NOW");
  assert.equal(artifacts.assembly.wires.length, 0);
  assert.ok(artifacts.assembly.parts.every((part) => !part.assetId.includes("xiao-expansion-base")));
  assert.deepEqual(
    artifacts.assembly.guideSteps.map((step) => step.title),
    ["Place the parts", "Pair the two devices", "Test the wireless update"],
  );
  assert.deepEqual(
    artifacts.assembly.guideSteps.slice(1).map((step) => step.wirelessLinkIds),
    [[artifacts.assembly.wirelessLinks[0].id], [artifacts.assembly.wirelessLinks[0].id]],
  );
  assert.ok(artifacts.assembly.guideSteps.every((step) => step.title !== "Check every connection"));
});

test("automatic Grove plans replace the visually inverted XIAO S3 asset with XIAO C6", async () => {
  const pipeline = await loadProductionBuildPipeline();
  const catalog = verifiedPartsCatalog();
  const xiaoS3 = catalog.find((part) => part.id === "b0drnvh8mq-1");
  const grovePir = catalog.find((part) => part.id === "mfg-seeed-101020020-122");
  assert.ok(xiaoS3 && grovePir);

  const selected = pipeline.createOptions({ env: {} }).finalizeSelectedParts([xiaoS3, grovePir], {
    idea: "Build a USB-powered motion detector with a Grove PIR sensor",
  });
  const controller = selected.find((part) => part.category === "controller");
  assert.equal(controller.assemblyAssets[0].partId, "seeed-xiao-esp32c6");
});

test("the ready-78 BME280 contract uses six proven carrier contacts", () => {
  const profiles = normalizeProductionProfileContracts(releaseProfiles);
  const bme280 = profiles.find((profile) => profile.assetId === "bme280-gy-bme280");
  assert.deepEqual(
    bme280.requiredSignalStraps.map((strap) => strap.terminationMode),
    ["separate-surface-contact-strap", "separate-surface-contact-strap"],
  );
  const graph = compileElectricalGraph({
    parts: [
      { id: "controller", assetId: "esp32-s3-devkitc-1-n8r2", role: "controller" },
      { id: "carrier", assetId: "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx", role: "carrier" },
      { id: "bme280", assetId: "bme280-gy-bme280", role: "sensor" },
    ],
    profiles,
  });
  const bmeGuides = graph.connections.filter((connection) => connection.toPartId === "bme280");
  assert.equal(bmeGuides.length, 6);
  assert.equal(new Set(bmeGuides.map((connection) => connection.surfaceEndpoint.nodeName)).size, 6);
  assert.equal(graph.invariants.requiredSignalStrapsResolved, true);
  assert.equal(graph.invariants.externalTerminalOccupancyValid, true);
});

test("the production release uses the upright XIAO C6 for an automatically injected Grove node", async () => {
  const profiles = normalizeProductionProfileContracts(releaseProfiles);
  const base = profiles.find((profile) => profile.assetId === "seeed-xiao-expansion-base-103030356");
  const xiaoS3 = profiles.find((profile) => profile.assetId === "seeed-xiao-esp32s3");
  const sharedMount = base.mounts.find((mount) => mount.id === "xiao-controller-socket-2x7");
  const s3Mount = base.mounts.find((mount) => mount.id === "xiao-esp32s3-controller-socket-2x7");
  assert.deepEqual(sharedMount.compatibleAssetIds, [
    "seeed-xiao-esp32c3",
    "seeed-xiao-esp32c5",
    "seeed-xiao-esp32c6",
  ]);
  assert.deepEqual(s3Mount.compatibleAssetIds, ["seeed-xiao-esp32s3"]);
  assert.deepEqual(s3Mount.rotation, [Math.PI / 2, 0, Math.PI]);
  assert.ok(xiaoS3.contacts.every((contact) => (
    JSON.stringify(contact.normal) === JSON.stringify([0, -1, 0])
  )));

  const catalog = verifiedPartsCatalog();
  const selectedIds = [
    "b0bvvgnbb3-112",
    "mfg-seeed-101020020-122",
    "b0dg8jz2tt-33",
    "b0gw8m3q3k-15",
  ];
  const parts = selectedIds.map((id) => catalog.find((part) => part.id === id));
  assert.ok(parts.every(Boolean));
  const artifacts = await createPrompt2CircuitArtifacts({
    parts,
    profiles,
    manifest: releaseManifest,
    validateRemoteAssets: false,
  });
  const injectedXiao = artifacts.assembly.parts.find((part) => (
    part.assetId === "seeed-xiao-esp32c6"
  ));
  assert.equal(injectedXiao.mountId, "xiao-controller-socket-2x7");
  assert.equal(injectedXiao.compilerInjected, true);
  assert.equal(artifacts.assembly.networkNodes.length, 2);
  assert.ok(artifacts.assembly.wires.length > 0);
});
