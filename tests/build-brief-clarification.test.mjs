import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assessBuildBrief, buildIdeaNeedsClarification } from "../lib/makeable-builds.mjs";

test("the reported Macintosh sensor idea asks what to sense without dropping its original idea", async () => {
  const idea="i want to build a macintosh with some sensors";
  assert.equal(buildIdeaNeedsClarification(idea),true);
  const result=await assessBuildBrief(idea,{env:{}});
  assert.equal(result.status,"needs_clarification");
  assert.equal(result.question,"What should it sense?");
  for(const choice of result.options){
    assert.ok(choice.refinedIdea.startsWith(idea));
    assert.equal(buildIdeaNeedsClarification(choice.refinedIdea),false);
  }
  assert.equal(buildIdeaNeedsClarification("A display with temperature and humidity sensors"),false);
});

test("theme-only ideas are intercepted while concrete build ideas continue", () => {
  assert.equal(buildIdeaNeedsClarification("make me something for halloween"), true);
  assert.equal(buildIdeaNeedsClarification("make me something for Christmas"), true);
  assert.equal(buildIdeaNeedsClarification("Build a pumpkin light that glows when someone approaches"), false);
  assert.equal(buildIdeaNeedsClarification("Build a CO2 monitor with a color display"), false);
});

test("abstract task and market devices clarify their physical interaction before a job starts", async () => {
  const taskIdea = "i want to create a desk buddy that can list out everyday task";
  const marketIdea = "Create me a device that will track my crypto and stocks";
  assert.equal(buildIdeaNeedsClarification(taskIdea), true);
  assert.equal(buildIdeaNeedsClarification(marketIdea), true);
  assert.equal(buildIdeaNeedsClarification("Build a desk task list with an OLED display and rotary dial"), false);

  const task = await assessBuildBrief(taskIdea, { env: {} });
  assert.equal(task.status, "needs_clarification");
  assert.match(task.question, /view and check off/i);
  assert.equal(task.options.length, 3);
  assert.ok(task.options.every((option) => buildIdeaNeedsClarification(option.refinedIdea) === false));

  const market = await assessBuildBrief(marketIdea, { env: {} });
  assert.equal(market.status, "needs_clarification");
  assert.match(market.question, /market tracker/i);
  assert.equal(market.options.length, 3);
});

test("underspecified phone messaging is clarified before a build starts", async () => {
  const idea = "Create me a device that can send a message to my partners phone";
  assert.equal(buildIdeaNeedsClarification(idea), true);
  assert.equal(buildIdeaNeedsClarification("Build a Wi-Fi desk button that sends a preset push notification to my partner's phone when touched"), false);

  const result = await assessBuildBrief(idea, { env: {} });
  assert.equal(result.status, "needs_clarification");
  assert.match(result.question, /trigger.*reach the phone/i);
  assert.deepEqual(result.options.map((option) => option.id), [
    "touch-check-in",
    "arrival-notification",
    "door-notification",
  ]);
  assert.ok(result.options.every((option) => /phone/i.test(option.refinedIdea)));
  assert.ok(result.options.every((option) => buildIdeaNeedsClarification(option.refinedIdea) === false));
});

test("off-topic model choices cannot replace messaging clarification", async () => {
  const result = await assessBuildBrief("send a message to my partner's phone", {
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        status: "needs_clarification",
        reason: "Choose a project.",
        question: "Which project?",
        options: [
          { id: "light", label: "Desk light", description: "A compact colored desk light for everyday use.", refinedIdea: "Build a compact RGB desk light with a touch button that changes colors." },
          { id: "monitor", label: "Room monitor", description: "A temperature and humidity display for a desk.", refinedIdea: "Build a room monitor that measures temperature and humidity and shows them on a display." },
          { id: "greeting", label: "Greeting screen", description: "A screen that reacts when someone approaches it.", refinedIdea: "Build a greeting display that detects nearby motion and shows an animation on a color screen." },
        ],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.deepEqual(result.options.map((option) => option.id), [
    "touch-check-in",
    "arrival-notification",
    "door-notification",
  ]);
});

test("the model can turn an ambiguous theme into three concrete directions", async () => {
  let capturedPayload;
  const result = await assessBuildBrief("make me something for halloween", {
    env: { OPENAI_API_KEY: "test-key" },
    prompt: "Ask one useful build question.",
    plannerCatalog: [{ id: "rgb", name: "RGB LED", category: "output", subtype: "light" }],
    fetchFn: async (_url, request) => {
      capturedPayload = JSON.parse(request.body);
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          status: "needs_clarification",
          reason: "Halloween can become several different physical builds.",
          question: "Which Halloween project sounds best?",
          options: [
            { id: "pumpkin-light", label: "Pumpkin light", description: "A glowing pumpkin-shaped desk light.", refinedIdea: "Build a pumpkin-shaped Halloween desk light with an RGB glow controlled by a push button." },
            { id: "spooky-display", label: "Spooky display", description: "A screen that shows a spooky animated face.", refinedIdea: "Build a Halloween desk display that shows a spooky animated face on a color screen." },
            { id: "door-chime", label: "Door chime", description: "A button-triggered spooky door sound.", refinedIdea: "Build a Halloween door chime with a push button, sound output, and a flashing status light." },
          ],
        }),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  assert.equal(result.status, "needs_clarification");
  assert.equal(result.options.length, 3);
  assert.equal(capturedPayload.text.format.name, "makeable_build_brief_clarification");
  assert.match(capturedPayload.input[1].content, /make me something for halloween/i);
  assert.match(capturedPayload.input[1].content, /RGB LED/);
});

test("specific ideas do not incur a clarification model request", async () => {
  let requested = false;
  const result = await assessBuildBrief("Build a temperature and humidity monitor with a display", {
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => { requested = true; throw new Error("must not be called"); },
  });
  assert.equal(result.status, "ready");
  assert.equal(requested, false);
});

test("a model cannot wave an already-detected ambiguous theme into planning", async () => {
  const result = await assessBuildBrief("make me something for halloween", {
    env: { OPENAI_API_KEY: "test-key" },
    fetchFn: async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        status: "ready",
        reason: "This is ready.",
        question: "",
        options: [],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.equal(result.status, "needs_clarification");
  assert.equal(result.options.length, 3);
});

test("ambiguous ideas still receive safe topic-aware choices if the model is unavailable", async () => {
  const result = await assessBuildBrief("make me something for halloween", { env: {} });
  assert.equal(result.status, "needs_clarification");
  assert.equal(result.options.length, 3);
  assert.match(result.question, /Halloween/);
  assert.match(result.options[0].refinedIdea, /pumpkin/i);
});

test("clarification happens before quota lookup or job creation", async () => {
  const source = await readFile(new URL("../netlify/functions/api.mjs", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("async function startAnonymousBuildJob"), source.indexOf("async function accountBuilds"));
  assert.ok(handler.indexOf("pipeline.assessIdea") < handler.indexOf("accountBuildQuota"));
  assert.ok(handler.indexOf("pipeline.assessIdea") < handler.indexOf("createAnonymousBuildJob"));
  assert.match(handler, /return jsonResponse\(\{ clarification \}, 200/);
});
