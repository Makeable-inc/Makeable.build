import catalogCsv from "./verified-parts-catalog-data.mjs";
import { geometrySummaryForBuild } from "./geometry-contract.mjs";

export const DEFAULT_BUILD_MODEL = "gpt-5.4-mini";
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";
export const DEFAULT_IMAGE_QUALITY = "medium";
export const DEFAULT_BUILD_SERVICE_TIER = "priority";

const fallbackImages = [
  "/concepts/community-v1/assets/window-air-monitor-v1.webp",
  "/concepts/community-v1/assets/pet-water-reminder-v1.webp",
  "/concepts/community-v1/assets/quiet-door-chime-v1.webp",
];

const catalog = loadCatalog();
const catalogById = new Map(catalog.map((part) => [part.id, part]));

export function verifiedPartsCatalog() {
  return catalog.map(publicPart);
}

export function catalogStats() {
  const selectable = catalog.filter((part) => part.modelSelectable);
  return {
    total: catalog.length,
    selectable: selectable.length,
    presolderedVerified: catalog.filter((part) => part.presoldered).length,
  };
}

export function createLocalBuildStore(filePath) {
  return {
    async list() {
      const { existsSync } = await import("node:fs");
      if (!existsSync(filePath)) return [];
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    async get(id) {
      return (await this.list()).find((build) => build.id === id) || null;
    },
    async save(build) {
      const [{ appendFile, mkdir }, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(build)}\n`, "utf8");
      return build;
    },
  };
}

export function createNetlifyBuildStore(store) {
  return {
    async list() {
      const page = await store.list();
      const builds = await Promise.all(
        page.blobs
          .filter((blob) => String(blob.key || "").startsWith("builds/"))
          .map((blob) => store.get(blob.key, { type: "json" })),
      );
      return builds
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    async get(id) {
      return await store.get(buildStoreKey(id), { type: "json" });
    },
    async save(build) {
      await store.setJSON(buildStoreKey(build.id), build, {
        metadata: { createdAt: build.createdAt },
      });
      return build;
    },
  };
}

export async function listPublicBuilds(store) {
  const builds = await store.list();
  return builds.map(publicBuild);
}

export async function getPublicBuild(store, id) {
  if (!safeBuildId(id)) return null;
  const build = await store.get(id);
  return build ? publicBuild(build) : null;
}

export async function createBuild(body, options) {
  const idea = sanitizeIdea(body?.idea);
  const email = sanitizeEmail(options?.userEmail || body?.email);
  if (!idea) return { status: 400, body: { error: "Describe what you want to build." } };
  if (!email && !options?.allowAnonymous) {
    return { status: 400, body: { error: "Enter a valid email to continue." } };
  }

  const env = options.env || {};
  const fetchFn = options.fetchFn || fetch;
  await options.onPhase?.("planning");
  const selected = await planBuild(idea, env, fetchFn);
  await options.onPhase?.("fitting_parts");
  const parts = pruneUnrequestedControls(
    pruneRedundantPresenceSensors(
      resolveSelectedParts(selected.selectedPartIds, idea),
      idea,
      selected,
    ),
    idea,
    selected,
  );
  const normalizedPlan = normalizePlan(selected, idea, parts);
  const geometry = geometrySummaryForBuild({
    idea,
    parts,
    plan: normalizedPlan,
    requestedAffordances: normalizedPlan.visibleHardwareCues,
  });
  const imagePrompt = makeImagePrompt(normalizedPlan, parts, idea, geometry.promptBlock);
  await options.onPhase?.("rendering");
  const image = await generateBuildImage(imagePrompt, idea, env, fetchFn);
  const createdAt = new Date().toISOString();
  const build = {
    id: newBuildId(idea),
    createdAt,
    idea,
    ...(email ? { email } : {}),
    title: normalizedPlan.title,
    summary: normalizedPlan.summary,
    behavior: normalizedPlan.behavior,
    visibleHardwareCues: normalizedPlan.visibleHardwareCues,
    imagePrompt,
    image,
    parts,
    warnings: normalizedPlan.warnings,
    geometryContract: geometry.contract,
    cost: calculateCost(parts),
    models: {
      planner: normalizedPlan.model,
      image: image.model,
    },
    status: "Concept",
  };

  await options.store.save(build);
  return { status: 201, body: publicBuild(build) };
}

async function planBuild(idea, env, fetchFn) {
  if (!env.OPENAI_API_KEY || env.MAKEABLE_FORCE_BUILD_FALLBACK === "1") {
    return fallbackPlan(idea, "deterministic_fallback");
  }

  try {
    const response = await openAIResponses(
      {
        model: env.OPENAI_BUILD_MODEL || env.OPENAI_MODEL || DEFAULT_BUILD_MODEL,
        service_tier: openAIServiceTier(env),
        reasoning: { effort: "low" },
        input: [
          {
            role: "developer",
            content: buildPlannerInstructions(),
          },
          {
            role: "user",
            content: JSON.stringify({
              idea,
              catalog: plannerCatalog(),
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "makeable_build_plan",
            strict: true,
            schema: buildPlanSchema(),
          },
        },
      },
      env,
      fetchFn,
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Planner request failed.");
    const text = outputText(data);
    const parsed = JSON.parse(text);
    return { ...parsed, model: env.OPENAI_BUILD_MODEL || env.OPENAI_MODEL || DEFAULT_BUILD_MODEL };
  } catch (error) {
    return {
      ...fallbackPlan(idea, "fallback_after_openai_error"),
      warnings: [
        ...fallbackPlan(idea, "fallback_after_openai_error").warnings,
        "OpenAI planning failed in this environment, so Makeable used the deterministic catalog matcher.",
      ],
    };
  }
}

async function generateBuildImage(prompt, idea, env, fetchFn) {
  const fallback = fallbackImageForIdea(idea);
  if (!env.OPENAI_API_KEY || env.MAKEABLE_SKIP_IMAGE_GENERATION === "1" || env.MAKEABLE_FORCE_BUILD_FALLBACK === "1") {
    return {
      url: fallback,
      source: "preview_fallback",
      status: "fallback",
      model: "static-preview",
    };
  }

  const response = await fetchFn(openAIEndpoint(env, "/v1/images/generations"), {
      method: "POST",
      headers: openAIHeaders(env),
      signal: openAITimeoutSignal(env),
      body: JSON.stringify({
        model: env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
        prompt,
        n: 1,
        size: env.OPENAI_IMAGE_SIZE || "1024x1024",
        quality: imageQuality(env.OPENAI_IMAGE_QUALITY),
      }),
    });
  const data = await response.json();
  if (!response.ok) throw buildGenerationError(data?.error?.message || "Image generation failed.");
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw buildGenerationError("Image generation returned no image.");
  return {
    url: `data:image/png;base64,${b64}`,
    source: "openai",
    status: "generated",
    model: env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
  };
}

async function openAIResponses(payload, env, fetchFn) {
  const requestPayload = openAIRequestPayload(payload, env);
  const response = await fetchFn(openAIEndpoint(env, "/v1/responses"), {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify(requestPayload),
  });
  if (!usesDirectOpenAI(env) || payload.service_tier !== "priority" || response.ok) return response;

  const text = await response.clone().text();
  if (!/service[_\s-]*tier|priority.*(?:unavailable|not enabled|not supported)/i.test(text)) {
    return response;
  }
  return fetchFn(openAIEndpoint(env, "/v1/responses"), {
    method: "POST",
    headers: openAIHeaders(env),
    body: JSON.stringify({ ...payload, service_tier: "default" }),
  });
}

function buildPlannerInstructions() {
  return [
    "You are Makeable's parts planner for beginner-friendly ESP32 builds.",
    "Return only JSON matching the schema.",
    "Select only part ids present in the provided catalog.",
    "For ordinary boards and breakout modules, select only visually verified rows whose male headers are already factory-soldered. Connector and actuator exceptions are allowed only when the exact catalog row is a complete factory-crimped, factory-housed cable or a component with a factory-attached plug; never require the beginner to solder, crimp, or assemble a connector.",
    "Every row in the provided catalog has already passed its applicable ready-to-use verification gate; do not claim a matching verified input, cable, or actuator is unavailable when it appears in the catalog.",
    "Prefer one ESP32 controller, then the minimum sensors, inputs, outputs, displays, actuators, and cable assemblies required by the idea and able to fit inside one practical 3D-printable product.",
    "Treat display choice as an interaction-design decision, not a default checkbox. Select no display when the idea can communicate through its requested light, sound, or motion alone. Use the 0.91-inch OLED only for explicitly tiny, wearable, single-line, or minimal-status interfaces. Prefer a 1.47-inch integrated ESP32 IPS/touch board for dashboards, charts, color data, or touch; a 16x2 LCD for fixed text and retro timers; a 1.54- or 2.25-inch TFT for color graphics and expressive companions; and the 2.42-inch OLED for larger monochrome information. When an integrated ESP32 display board satisfies the controller role, do not add a second ESP32.",
    "For every plant or soil-moisture build, use one compact self-contained device that inserts directly into the soil. Prefer the integrated ESP32-C6 1.47-inch portrait IPS/TFT as the single controller and display. If a dimension-verified capacitive soil-moisture sensor is selected, integrate its sensing blade directly below the above-soil display head; never create a separate tabletop station, loose probe, external harness, or cable-connected sensor. If no verified soil sensor is available, say so and do not invent one.",
    "Size the product around the active interaction area. A display must feel intentionally proportioned to its enclosure: dashboards and companions need a clearly dominant readable screen, while a tiny OLED is acceptable only on a correspondingly tiny body. Do not bury a small screen in a large empty shell.",
    "Use a verified low-power FS90R continuous-rotation micro servo when the user explicitly requests powered wheels, continuous rotation, or small robot-car movement. Do not substitute an ordinary positional SG90 servo, invent a DC motor or driver, or claim autonomous motion without a selected motion part.",
    "An FS90R must use its factory-attached three-pin servo plug and a separate regulated 4.8-6V servo supply with common ground. The ESP32 provides only the PWM control signal; never power a servo from an ESP32 GPIO or 3.3V pin. If the exact power or mating path is not present in the catalog, state that gap in warnings instead of pretending the wiring is complete.",
    "Select a verified cable assembly only when its exact connector geometry matches the connection: a 2P female-to-female Dupont cable joins two 2-pin male headers, while a 2P female-to-male cable joins a male header to a compatible two-position female connection. Never describe a 2P cable as a three-pin servo adapter, and never invent loose jumpers or unverified adapters.",
    "Choose a physical product architecture before describing the enclosure. Preserve the requested object's use, scale, posture, and silhouette; do not default to a rounded rectangular electronics box. Exposed mechanisms, desktop instruments, handheld controllers, environmental fixtures, and retro appliances should look materially different from one another.",
    "Closed housings must use concealed, serviceable snap fits only: tapered cantilever clips, locating lugs, a clean split line, and a small rear or underside release notch. Never specify screws, threaded fasteners, heat-set inserts, or visible fastener heads.",
    "Place the controller's USB-C opening on the rear, side-rear, or underside with cable bend clearance. Never place USB-C on the primary front interaction face unless the user's literal use case explicitly requires it.",
    "Use a closed opaque FDM shell for ordinary appliances. For a project where seeing the electronics materially explains the build, a localized smoke, frosted-clear, or tinted translucent PETG service shell is allowed only when it reveals exact selected, dimension-verified parts. Never use a transparent dome, glass cover, or decorative clear bubble.",
    "Every visibleHardwareCue must describe the enclosure itself or an external affordance supported by a selected part. Explicitly describe the fitted opening or affordance for a selected screen, knob, button, camera, speaker, light, or sensor when it needs to be visible, but never invent one that is not backed by a selected catalog part.",
    "Every hardware capability named in the title, summary, behavior, visibleHardwareCues, or warnings must be backed by one of the selected part ids. If a requested capability has no selected part, omit that capability from the prose and render rather than pretending it exists.",
    "Never propose a clear or transparent dome, glass cover, decorative topper, mascot, figurine, sculpture, toy animal, physical pet, or other object the maker would need to source separately.",
    "If the idea mentions a pet, cat, face, character, or companion, treat it as software behavior: show it only as simple pixels on a selected display. If no display is selected, omit the character entirely.",
    "Avoid batteries, mains power, relays, heaters, pumps, unverified DC or stepper motors, high-current motion hardware, level shifters, shift registers, and advanced glue parts. The only currently supported powered-motion exception is an exact verified low-power continuous-rotation micro-servo catalog row.",
    "Do not select ordinary HC-SR04 ultrasonic modules. The current catalog has no verified 3.3V-safe HC-SR04P direct-Echo listing, so use ToF/radar alternatives or add a warning.",
    "Do not claim HC-SR04 Echo can connect directly to ESP32 unless the exact selected catalog row is a verified 3.3V-safe HC-SR04P listing.",
    "Keep the controller and logic physically plausible for low-power ESP32 GPIO and USB-C operation. Treat a selected FS90R as a separately powered actuator with common ground, never as a GPIO-powered load.",
  ].join("\n");
}

function buildPlanSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      behavior: { type: "string" },
      selectedPartIds: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string" },
      },
      visibleHardwareCues: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: { type: "string" },
      },
      warnings: {
        type: "array",
        maxItems: 6,
        items: { type: "string" },
      },
    },
    required: ["title", "summary", "behavior", "selectedPartIds", "visibleHardwareCues", "warnings"],
  };
}

function plannerCatalog() {
  return catalog
    .filter((part) => part.modelSelectable)
    .map((part) => ({
      id: part.id,
      name: part.name,
      category: part.category,
      subtype: part.subtype,
      price: part.price,
      voltage: part.voltage,
      notes: part.notes,
      why: part.why,
    }));
}

function resolveSelectedParts(ids, idea) {
  const seen = new Set();
  const requested = Array.isArray(ids) ? ids : [];
  const parts = [];
  let controllerSelected = false;
  for (const id of requested) {
    const part = catalogById.get(String(id));
    if (!part || seen.has(part.id) || !part.modelSelectable) continue;
    if (isControllerPart(part)) {
      if (controllerSelected) continue;
      controllerSelected = true;
    }
    if (parts.some((selectedPart) => sameFunctionalRole(selectedPart, part))) continue;
    seen.add(part.id);
    parts.push(publicPart(part));
  }

  if (!parts.some(isControllerPart)) {
    const controller = fallbackController(idea);
    if (controller && !seen.has(controller.id)) {
      parts.unshift(publicPart(controller));
      seen.add(controller.id);
      controllerSelected = true;
    }
  }

  // Deterministically fill obvious intent-critical roles (for example, a
  // rotary encoder for a knob request) even when the model returns a plan that
  // is technically valid but incomplete. This also makes the no-key preview
  // path and live model path obey the same physical requirements.
  for (const part of fallbackPartsForIdea(idea)) {
    if (seen.has(part.id)) continue;
    if (isControllerPart(part) && controllerSelected) continue;
    if (parts.some((selectedPart) => sameFunctionalRole(selectedPart, part))) continue;
    parts.push(publicPart(part));
    seen.add(part.id);
    if (isControllerPart(part)) controllerSelected = true;
    if (parts.length >= 6) break;
  }

  return parts.slice(0, 8);
}

function sameFunctionalRole(left, right) {
  if (left.category === "controller" && right.category === "controller") return true;
  if (left.category === "display" && right.category === "display") return true;

  const leftRole = partFunctionalRole(left);
  return Boolean(leftRole && leftRole === partFunctionalRole(right));
}

function partFunctionalRole(part) {
  const text = `${part.category || ""} ${part.subtype || ""} ${part.name || ""}`.toLowerCase();
  if (/rotary|encoder|\bknob\b/.test(text)) return "rotary-input";
  if (/touch|capacitive button/.test(text)) return "touch-input";
  if (/bme280|temperature.*humidity|environment/.test(text)) return "environment-sensor";
  if (/bh1750|ambient light|lux/.test(text)) return "ambient-light-sensor";
  if (/reed|magnetic switch/.test(text)) return "contact-sensor";
  if (/buzzer|piezo/.test(text)) return "buzzer-output";
  if (/rain|water level|leak|liquid/.test(text)) return "water-sensor";
  if (/rgb.*led|led.*rgb/.test(text)) return "status-light-output";
  if (/ld2410|presence|radar/.test(text)) return "presence-sensor";
  if (/vl53|time.of.flight|\btof\b|distance/.test(text)) return "distance-sensor";
  if (/microphone|sound sensor/.test(text)) return "sound-input";
  if (/camera|imaging|vision/.test(text)) return "camera";
  if (/fs90r|continuous.rotation.*servo|servo.*continuous.rotation/.test(text)) return "continuous-motion-actuator";
  if (/dupont.*female.to.female|female.to.female.*dupont/.test(text)) return "two-pin-ff-cable";
  if (/dupont.*female.to.male|female.to.male.*dupont/.test(text)) return "two-pin-fm-cable";
  return "";
}

function pruneRedundantPresenceSensors(parts, idea, plan) {
  const proximityParts = parts.filter((part) => ["presence-sensor", "distance-sensor"].includes(partFunctionalRole(part)));
  if (proximityParts.length < 2) return parts;

  const ideaText = idea.toLowerCase();
  const asksForDistanceHardware = /\b(?:tof|time[- ]of[- ]flight|distance sensor|range sensor|proximity sensor|ultrasonic)\b/.test(ideaText);
  const asksForPresenceHardware = /\b(?:radar|mmwave|ld2410)\b/.test(ideaText);
  if (asksForDistanceHardware && asksForPresenceHardware) return parts;

  const planText = `${plan?.summary || ""} ${plan?.behavior || ""}`.toLowerCase();
  const describesDistanceHardware = /\b(?:tof|time[- ]of[- ]flight|distance sensor|range sensor|proximity sensor|ultrasonic)\b/.test(planText);
  const describesPresenceHardware = /\b(?:radar|mmwave|ld2410)\b/.test(planText);
  if (describesDistanceHardware === describesPresenceHardware) return parts;

  const keepRole = describesDistanceHardware ? "distance-sensor" : "presence-sensor";
  let kept = false;
  return parts.filter((part) => {
    const role = partFunctionalRole(part);
    if (!["presence-sensor", "distance-sensor"].includes(role)) return true;
    if (role !== keepRole || kept) return false;
    kept = true;
    return true;
  });
}

function pruneUnrequestedControls(parts, idea, plan) {
  const intentText = `${idea} ${plan?.summary || ""} ${plan?.behavior || ""}`.toLowerCase();
  return parts.filter((part) => {
    // Integrated controller/display boards may include touch in their product
    // name. They remain the controller even when the user does not request
    // touch; only standalone input modules are pruned here.
    if (isControllerPart(part) || part.category === "display") return true;
    const role = partFunctionalRole(part);
    if (role === "touch-input") return /\b(?:touch|tap|press|button|capacitive)\b/.test(intentText);
    if (role === "rotary-input") return /\b(?:knob|dial|rotary|encoder)\b/.test(intentText);
    return true;
  });
}

function normalizePlan(plan, idea, parts) {
  const fallback = fallbackPlan(idea, "normalization_fallback");
  const title = readableTitle(plan?.title || fallback.title, idea);
  const selectedCategories = new Set(parts.map((part) => part.category));
  const selectedText = parts.map((part) => `${part.name} ${part.subtype || ""}`).join(" ").toLowerCase();
  const planWarnings = (Array.isArray(plan?.warnings) ? plan.warnings : []).filter((warning) => {
    const text = clean(warning).toLowerCase();
    if (/not selected/.test(text) && /dupont|jumper|cable/.test(text) && /dupont|jumper|cable/.test(selectedText)) {
      return false;
    }
    if (/no catalog item|could not be selected|not available/.test(text)) {
      if (/(button|knob|control|input|encoder)/.test(text) && selectedCategories.has("input")) return false;
      if (/(display|screen|oled|lcd)/.test(text) && selectedCategories.has("display")) return false;
      if (/(sensor|sensing)/.test(text) && selectedCategories.has("sensor")) return false;
    }
    return true;
  });
  const warnings = new Set([
    ...planWarnings,
    ...safetyWarnings(idea, parts),
  ]);

  return {
    title,
    summary: cleanSentence(plan?.summary) || fallback.summary,
    behavior: cleanSentence(plan?.behavior) || fallback.behavior,
    visibleHardwareCues: enclosureHardwareCues(plan?.visibleHardwareCues, parts, idea),
    warnings: [...warnings].map((warning) => cleanSentence(warning)).filter(Boolean).slice(0, 8),
    model: plan?.model || fallback.model,
  };
}

function enclosureHardwareCues(value, parts, idea = "") {
  const selectedText = parts.map((part) => `${part.category || ""} ${part.subtype || ""} ${part.name || ""} ${part.voltage || ""}`).join(" ").toLowerCase();
  const hasDisplay = parts.some((part) => part.category === "display") || /\boled\b|\blcd\b|display|screen/.test(selectedText);
  const hasInput = parts.some((part) => part.category === "input") || /button|touch|rotary|encoder|knob/.test(selectedText);
  const hasOutput = parts.some((part) => part.category === "output") || /\bled\b|buzzer|speaker/.test(selectedText);
  const hasSensor = parts.some((part) => part.category === "sensor");
  const hasCamera = /camera|imaging|vision/.test(selectedText);
  const hasUsbC = /usb-c|usb c|type-c|type c/.test(selectedText);
  const hasRotary = /rotary|encoder|knob|dial/.test(selectedText);
  const hasTouch = /touch|capacitive/.test(selectedText);
  const hasAudio = /buzzer|speaker|piezo/.test(selectedText);
  const hasVisualOutput = /\bled\b|rgb/.test(selectedText);
  const hasMotion = /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/.test(selectedText);
  const hasWheelIntent = /\bcar\b|rover|wheeled|wheel|vacuum|floor robot|trash sort/.test(String(idea).toLowerCase());
  const hasPositionalServo = /positional.*servo|servo.*(?:90|180|270)[- ]?degree/.test(selectedText)
    && !/continuous.rotation/.test(selectedText);
  const allowed = [];

  for (const rawCue of cleanStringArray(value, [])) {
    const cue = cleanSentence(rawCue, 180);
    const text = cue.toLowerCase();
    const describesCharacter = /pet|cat|dog|animal|character|creature|mascot/.test(text)
      || (/\bface\b/.test(text) && /cute|pixel|smil|expression/.test(text));
    if (describesCharacter) {
      if (hasDisplay) allowed.push("simple pixel companion shown only on the selected display screen");
      continue;
    }
    if (/clear dome|dome|glass|cloche|bubble|acrylic|figurine|sculpture|decorative topper|floating|separate prop/.test(text)) continue;
    if (/display|screen|oled|lcd/.test(text) && !hasDisplay) continue;
    if (/button|touch|knob|dial|rotary|encoder/.test(text) && !hasInput) continue;
    if (/light|led|indicator|buzzer|speaker/.test(text) && !hasOutput) continue;
    if (/sensor|probe|vent|aperture/.test(text) && !hasSensor && !hasCamera) continue;
    if (/camera|lens/.test(text) && !hasCamera) continue;
    if (/powered wheel|drive wheel|wheel opening|axle/.test(text) && (!hasMotion || !hasWheelIntent)) continue;
    if (/motor|servo/.test(text) && !hasMotion) continue;
    if (/usb|power.*cutout|programming.*cutout|connector.*cutout/.test(text)) continue;
    if (/screw|threaded|heat[- ]set|fastener head/.test(text)) continue;
    allowed.push(cue);
  }

  const inferred = [];
  if (hasDisplay) inferred.push("flush display opening sized to the selected screen module");
  if (hasRotary) inferred.push("single clean shaft opening sized to the selected rotary control");
  else if (hasTouch) inferred.push("flat marked touch area supported by the selected capacitive input");
  else if (hasInput) inferred.push("clean panel feature sized to the selected input control");
  if (hasSensor || hasCamera) inferred.push("unblocked sensor aperture aligned with the selected module");
  if (hasAudio) inferred.push("small printable sound grille aligned with the selected audio output");
  if (hasVisualOutput && !hasDisplay) inferred.push("small indicator opening aligned with the selected light output");
  if (hasMotion && hasWheelIntent) inferred.push("paired wheel clearances and axle openings aligned with the selected continuous-rotation servos");
  else if (hasMotion) inferred.push("single continuous-servo output clearance aligned to the requested rotating linkage; omit the listing's optional wheels");

  return [...new Set([
    "project-specific FDM body shaped by the requested object's real use and silhouette",
    "clean two-part shell seam with concealed tapered snap clips and locating lugs; zero screws",
    hasUsbC ? "recessed USB-C opening on the rear, side-rear, or underside with cable bend room" : "rear or underside power and programming access matched to the selected controller",
    ...allowed,
    ...inferred,
  ])].slice(0, 8);
}

function fallbackPlan(idea, model) {
  const title = readableTitle("", idea);
  const fallbackParts = fallbackPartsForIdea(idea);
  const parts = fallbackParts.map((part) => part.id);
  return {
    title,
    summary: `A compact Makeable build for ${idea.toLowerCase()}.`,
    behavior: "Uses an ESP32 controller with simple sensors or outputs from the verified pre-soldered catalog.",
    selectedPartIds: parts,
    visibleHardwareCues: [
      "project-specific FDM body shaped by the requested object's real use and silhouette",
      "concealed serviceable snap-fit seam with locating lugs and zero screws",
      "recessed rear or side-rear USB-C power opening",
    ],
    warnings: safetyWarnings(idea, fallbackParts.map(publicPart)),
    model,
  };
}

function fallbackPartsForIdea(idea) {
  const text = idea.toLowerCase();
  const picks = [fallbackController(idea)];
  const add = (...needles) => {
    for (const needle of needles) {
      const part = findPart(needle);
      if (part && !picks.includes(part)) picks.push(part);
    }
  };

  if (/(humidity|weather|air (?:quality|monitor|sensor)|temperature|temp|climate)/.test(text)) {
    add("BME280", "BH1750");
  }
  if (/(door|mailbox|cabinet|drawer)/.test(text)) add("Reed switch", "DIYables RGB LED Module");
  if (/(water|bowl|leak|rain|liquid)/.test(text)) add("Rain Water Level", "DIYables RGB LED Module");
  if (/(plant|soil(?: moisture)?|planter|garden moisture)/.test(text)) add("DIYables TLC555I Capacitive Soil Moisture Sensor");
  if (/(motion|presence|walk|person|room|occupancy)/.test(text)) add("LD2410C", "DIYables RGB LED Module");
  if (/(distance|range|near|far|ultrasonic|hc-sr04|hcsr04)/.test(text)) add("VL53L1X");
  if (/(sound|noise|voice|microphone|clap)/.test(text)) add("Sound Sensor");
  if (/(camera|photo|vision|image)/.test(text)) add("Camera Development Board");
  if (/(button|touch|press|control)/.test(text)) add("Touch Sensor");
  if (/(knob|dial|rotary|encoder)/.test(text)) add("Rotary Encoder");
  const display = fallbackDisplayForIdea(idea);
  if (display && !picks.includes(display)) picks.push(display);
  if (/(ambient light|light sensor|lux|brightness)/.test(text)) add("BH1750");
  if (/(light|lamp|led|glow)/.test(text)) add("DIYables RGB LED Module");
  if (/(continuous[- ]rotation|powered wheels?|robot car|toy car|drive wheels?|motorized|\bfs90r\b)/.test(text)) {
    add("FS90R 360-degree continuous-rotation micro servos with wheels");
  }
  if (/(dupont|jumper (?:wire|cable)|female[- ]to[- ]female cable)/.test(text)) {
    add("ZYAMY 10PCS 2P 2.54mm Female-to-Female Dupont Cable");
  }

  return picks.filter(Boolean).slice(0, 6);
}

function fallbackController(idea) {
  const text = idea.toLowerCase();
  if (/(camera|photo|vision|image)/.test(text)) return findPart("ESP32-S3 WROOM N16R8 Camera");
  const display = fallbackDisplayForIdea(idea);
  if (display && isControllerPart(display)) return display;
  return findPart("Seeed Studio XIAO ESP32C3") || findPart("Seeed Studio XIAO ESP32S3");
}

function fallbackDisplayForIdea(idea) {
  const text = String(idea || "").toLowerCase();
  if (/(plant|soil(?: moisture)?|planter|garden moisture)/.test(text)) {
    return findPart("ESP32-C6 1.47inch IPS Touch Display");
  }
  const asksForDisplay = /(display|screen|status|dashboard|clock|timer|message|readout|interface|chart|graph|weather station|air quality|pet|companion|character|face|animation|game)/.test(text);
  if (!asksForDisplay) return null;

  // A tiny monochrome OLED is a deliberate size constraint, not the universal
  // fallback. Keep it only for genuinely tiny, single-line, wearable status.
  if (/(tiny|wearable|badge|tag|single[- ]line|minimal status|micro status)/.test(text)) {
    return findPart("0.91-inch I2C OLED");
  }

  // Dashboards and color/touch interfaces benefit from an integrated display
  // controller, avoiding a second ESP32 and preserving a large interaction area.
  if (/(dashboard|chart|graph|touch|weather station|air quality|color trends|data panel)/.test(text)) {
    return findPart("ESP32-C6 1.47inch IPS Touch Display");
  }

  // Fixed text and retro timers map naturally to a wide character LCD.
  if (/(16x2|1602|character lcd|retro.*(?:clock|timer)|kitchen timer|countdown)/.test(text)) {
    return findPart("16x2 / Pre-Soldered Pin Header") || findPart("LC1602-Keypad");
  }

  // Expressive companions and graphic interfaces need a real color canvas.
  if (/(pet|companion|character|face|animation|game|pixel art|color display)/.test(text)) {
    return findPart("1.54 Inch TFT LCD Display Module");
  }

  // Larger monochrome information surfaces retain OLED contrast without
  // collapsing back to the tiny 0.91-inch module.
  if (/(music|message|large monochrome|e[- ]?paper-like|high contrast)/.test(text)) {
    return findPart("2.42 Inch OLED Display Module");
  }

  return findPart("2.25 Inch TFT LCD Display Module")
    || findPart("1.54 Inch TFT LCD Display Module")
    || findPart("2.42 Inch OLED Display Module");
}

function findPart(nameNeedle) {
  const needle = nameNeedle.toLowerCase();
  return catalog.find((part) => (
    part.modelSelectable
    && `${part.name} ${part.listingTitle} ${part.subtype}`.toLowerCase().includes(needle)
  ));
}

function safetyWarnings(idea, parts) {
  const warnings = [];
  const text = idea.toLowerCase();
  if (/(plant|soil(?: moisture)?|planter|garden moisture)/.test(text)
    && !parts.some((part) => /capacitive.*soil|soil.*moisture|moisture.*(?:sensor|probe)/i.test(`${part.name} ${part.subtype || ""}`))) {
    warnings.push("The verified catalog does not currently include a dimension-verified capacitive soil-moisture sensor, so the render must not invent a sensing blade or claim soil-moisture readings.");
  }
  if (/(hc-sr04|hcsr04|ultrasonic)/.test(text)) {
    warnings.push(
      "The current verified catalog does not include a 3.3V-safe HC-SR04P listing, so this build avoids direct HC-SR04 Echo-to-ESP32 wiring.",
    );
  }
  if (parts.some((part) => /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/i.test(`${part.name} ${part.subtype || ""}`))) {
    warnings.push("Power each FS90R from a separate regulated 4.8-6V servo supply with common ground; the ESP32 supplies PWM signal only and must not power the servo from GPIO or its 3.3V pin.");
    warnings.push("The selected FS90R has a factory-attached three-pin servo plug. Do not treat a two-pin Dupont cable as its mating adapter; confirm the exact power-distribution and three-pin mating path before assembly.");
  } else if (parts.some((part) => /motor|mosfet|12v|24v|36v|high voltage/i.test(`${part.name} ${part.notes || ""}`))) {
    warnings.push("Confirm the load current and driver limits before powering anything beyond small indicator modules.");
  }
  warnings.push("All suggested parts are from visually verified ready-to-use catalog rows: ordinary boards have factory-soldered male headers, while allowed cables and servo leads are factory-crimped and housed. Stock and pricing can change.");
  return warnings;
}

function calculateCost(parts) {
  const priced = parts.filter((part) => part.priceSource === "listing");
  const knownSubtotal = priced.reduce((sum, part) => sum + part.unitPriceUsd, 0);
  const estimatedTotal = parts.reduce((sum, part) => sum + part.unitPriceUsd, 0);
  const planningEstimates = parts.length - priced.length;
  return {
    estimatedTotalUsd: Number(estimatedTotal.toFixed(2)),
    knownSubtotalUsd: Number(knownSubtotal.toFixed(2)),
    pricedParts: priced.length,
    totalParts: parts.length,
    estimateLabel: `$${estimatedTotal.toFixed(2)} estimated parts total`,
    note: planningEstimates
      ? `${planningEstimates} item price${planningEstimates === 1 ? " is" : "s are"} a clearly marked planning estimate. Confirm live listing prices; shipping and tax are not included.`
      : "All item prices came from the verified catalog snapshot. Confirm live listing prices; shipping and tax are not included.",
  };
}

export function createBuildImagePrompt(build = {}) {
  const idea = sanitizeIdea(build.idea || build.title || "beginner electronics project");
  const parts = Array.isArray(build.parts) ? build.parts : [];
  const plan = {
    title: clean(build.title || readableTitle("", idea)),
    summary: cleanSentence(build.summary || ""),
    behavior: cleanSentence(build.behavior || build.summary || "A beginner-buildable electronics project."),
    visibleHardwareCues: enclosureHardwareCues(build.visibleHardwareCues, parts, idea),
    warnings: cleanStringArray(build.warnings, []),
  };
  const geometry = geometrySummaryForBuild({
    idea,
    parts,
    plan,
    requestedAffordances: plan.visibleHardwareCues,
  });
  return {
    prompt: makeImagePrompt(plan, parts, idea, geometry.promptBlock),
    geometryContract: geometry.contract,
    designBrief: renderDesignBrief(idea, plan, parts),
  };
}

function makeImagePrompt(plan, parts, idea, geometryPromptBlock = "") {
  const partsSummary = parts.map((part) => (
    part.voltage ? `${part.name} (${part.voltage})` : part.name
  )).join("; ");
  const cues = plan.visibleHardwareCues.join(", ");
  const limitations = (plan.warnings || []).join("; ") || "No additional limitation was identified.";
  const hasDisplay = parts.some((part) => part.category === "display")
    || parts.some((part) => /oled|lcd|display|screen/i.test(`${part.name} ${part.subtype || ""}`));
  const hasContinuousServo = parts.some((part) => /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/i.test(`${part.name} ${part.subtype || ""}`));
  const hasWheelIntent = /\bcar\b|rover|wheeled|wheel|vacuum|floor robot|trash sort/i.test(`${idea} ${plan.title || ""} ${plan.behavior || ""}`);
  const selectedCables = parts.filter((part) => part.category === "connector" && /cable|jumper|dupont/i.test(`${part.name} ${part.subtype || ""}`));
  const isPlantOrSoilBuild = /(plant|soil(?: moisture)?|planter|garden moisture)/i.test(`${idea} ${plan.title || ""} ${plan.behavior || ""}`);
  const hasSoilMoistureSensor = parts.some((part) => /capacitive.*soil|soil.*moisture|moisture.*(?:sensor|probe)/i.test(`${part.name} ${part.subtype || ""}`));
  const design = renderDesignBrief(idea, plan, parts);
  return [
    "Create one physically credible project-documentation photograph of a beginner-buildable Makeable electronics project. It must look like a real, carefully assembled prototype photographed in a product studio—not an AI concept render.",
    "",
    `User intent: ${idea}. Interpret aesthetic references semantically instead of copying the nearest modern product. Preserve the requested use, environment, posture, and recognizable physical archetype without turning every idea into the same box or illustrating every noun literally.`,
    `Build concept: ${plan.title}.`,
    `Supported behavior: ${plan.behavior}`,
    `Exact selected electronic inventory: ${partsSummary}. No other electronic component may appear.`,
    isPlantOrSoilBuild
      ? hasSoilMoistureSensor
        ? "Plant/soil architecture contract: Make this one compact self-contained instrument placed directly into soil. Integrate the portrait TFT/controller head and the selected capacitive sensing blade into one continuous device. Keep the complete electronics head and service seam above the soil line, add a protective overhanging soil-stop shoulder, and extend the real selected sensing blade directly below it. Never show a separate tabletop station, detached probe, external harness, cable-connected sensor, decorative plant silhouette, or second device."
        : "Plant/soil fail-closed contract: No dimension-verified capacitive soil-moisture sensor is selected. Keep the controller/display in one compact above-soil environmental stake, but do not show a sensing blade, separate probe, external cable, or claim soil-moisture sensing."
      : "",
    `Supported exterior cues only: ${cues}.`,
    `Honest limitations and adaptations: ${limitations}. Any unsupported requested feature must become passive, manual, omitted, or visibly simplified; never render it as if unsupported electronics exist.`,
    "",
    geometryPromptBlock,
    "",
    "PROJECT-SPECIFIC DESIGN BRIEF:",
    `- Physical archetype: ${design.archetype}.`,
    `- Form language: ${design.formLanguage}`,
    `- Construction visibility: ${design.visibilityStrategy}`,
    `- Connector placement: ${design.connectorPlacement}`,
    `- Camera and composition: ${design.cameraDirection}`,
    `- Material direction: ${design.materialDirection}`,
    `- Signature silhouette: ${design.signatureSilhouette}`,
    `- Delight moment: ${design.delightMoment}`,
    `- Color story: ${design.colorStory}`,
    design.semanticReferenceRule,
    "",
    "FDM construction contract: Closed housings use one or two printable shell pieces with 2.0-2.4 mm-looking walls, a build-plate-friendly orientation, modest radii, one honest seam, concealed tapered cantilever snap clips, root fillets, locating lugs, about 0.5 mm snap clearance, and a small release notch hidden on the rear or underside. Show zero screws, zero bolts, zero threaded inserts, and zero visible fastener heads anywhere. Exposed mechanisms use printed pins, captured axles, press fits, or snap retainers instead of screws. Avoid deep undercuts and support-heavy geometry.",
    "Exact-parts contract: Every visible control, display, light, lens, grille, sensor opening, connector, and port must correspond to the exact selected inventory. Keep electronics subordinate to the requested object. Hide internal modules behind only the necessary fitted openings. Do not invent a knob, button, screen, camera, speaker, light, sensor, cable, battery, or accessory.",
    "Proportion contract: Drive the body dimensions from the verified component envelope and keepouts. A selected display must remain within its verified active area and serve only its supported function; it must never substitute for the requested object. Leave believable wiring, connector, and service clearance without making the body oversized.",
    "Desirability contract: This must look like a crisp, mature small-batch hardware prototype from a strong industrial-design studio—professional enough to trust, attainable enough to build, and distinctive enough to want immediately. Create warmth through proportion, posture, tactility, one subtle interaction detail, and honest construction. Do not use candy colors, oversized toy features, arbitrary holes, mascot styling, or novelty geometry.",
    "Design-rationale gate: Every curve, opening, recess, shoulder, stand, transparent area, split line, and color break must have one defensible job: grip, viewing angle, motion clearance, airflow, sensor line of sight, stability, mounting, cable routing, assembly, or access to an exact selected part. Delete any form feature that cannot be explained this way. Do not force an arch, ring, waist, or asymmetry merely to avoid a box.",
    "Silhouette test: At 64 pixels the object should communicate its real product category through posture, proportion, interaction layout, or exposed mechanism. A compact rectilinear shell is acceptable when function demands it, but it must not be the same rounded box reused across unrelated projects. Distinction must come from the use case and assembly—not decorative distortion.",
    hasContinuousServo && hasWheelIntent
      ? "Motion contract: Use only the selected FS90R continuous-rotation servos and the exact wheels included with the selected listing. Show exactly two wheels total: one single 60 mm diameter by 8 mm wide tire on the left and one single 60 mm diameter by 8 mm wide tire on the right, both centered on the same transverse axle line. Never show a dual tire, doubled rim, tandem wheel, caster, hidden third wheel, or overlapping extra wheel. Use a narrow project-specific structural spine or cradle rather than a generic box; let the exact FS90R body proportions and believable output-shaft alignment read through purposeful side openings or snap-in printed retainers, but cover every factory screw head with a screw-free clip-on printed side bezel. Do not invent a gearbox, DC motor, motor driver, battery, extra wheel, or hidden power source. The ESP32 provides PWM signal only; servo power comes through a separate regulated 4.8-6V path that is acknowledged by the plan but not replaced by imaginary hardware in the render."
      : hasContinuousServo
        ? "Motion contract: The selected FS90R listing includes optional wheels, but this project is not wheeled. Do not show any wheel, tire, axle, drivetrain, car chassis, or caster. Use only one exact FS90R body and its output shaft for the requested continuous rotating linkage, retained with a screw-free printed clip or captured shaft cover. If the requested linkage cannot be shown without inventing parts, keep the servo internal and show no external mechanism."
      : "Motion contract: No verified motion actuator is selected, so show no powered wheel, motor, servo, drivetrain, or autonomous movement.",
    selectedCables.length
      ? `Cable contract: The selected factory-terminated cable assemblies (${selectedCables.map((part) => part.name).join("; ")}) may be visible only through an intentional translucent service shell or on an exposed mechanism. Preserve their exact pin count and end genders, route them in short tidy bundles with believable bend radii and strain relief, and do not turn a 2P cable into a three-pin servo adapter.`
      : "Cable contract: No cable assembly is selected, so do not show loose jumpers, pigtails, or invented adapters.",
    hasDisplay
      ? "Character rule: If the idea mentions a pet, cat, face, mascot, creature, or companion, show it only as a simple low-resolution pixel graphic inside the selected display. The enclosure may have friendly proportions, but there must be no physical character attached to it or sitting under a cover."
      : "Character rule: No display is selected, so do not show any face, character, pet, cat, mascot, creature, or companion anywhere on or around the product.",
    "",
    isPlantOrSoilBuild && hasSoilMoistureSensor
      ? "Studio contract: Photograph one complete prototype in a professional industrial-design studio on a seamless medium cool-gray sweep meeting a slightly darker matte-gray surface. Use a broad overhead softbox, directional upper-left key, subtle cool rear rim, neutral fill, crisp edge separation, restrained surface reflection, and a dense natural contact shadow. Insert the single device into a low neutral-gray test vessel filled with dark potting soil solely to prove insertion depth and scale. No plant, leaves, flowers, decorative pot, wooden table, room, workshop clutter, lifestyle scene, dramatic orange/blue grading, or fake pedestal. Use a slightly elevated 3/4 front-side view showing the portrait display, body depth, receding service strip, protective soil-stop shoulder, and selected blade entering the soil. The USB-C cutout belongs on the unseen rear upper edge and must not be visible anywhere."
      : "Studio contract: Photograph one complete prototype in a professional industrial-design studio on a seamless medium cool-gray sweep meeting a slightly darker matte-gray surface. Use a broad overhead softbox, directional upper-left key, subtle cool rear rim, neutral fill, crisp edge separation, restrained surface reflection, a dense natural contact shadow, and controlled negative space. No pure-white void, wooden table, plant, room, workshop clutter, lifestyle scene, dramatic orange/blue grading, or fake showroom pedestal. Follow the project-specific camera direction above; otherwise use a natural 3/4 documentation angle that reveals the primary interaction face and a non-connector side. The USB-C cutout belongs on the unseen rear or underside and must not be visible anywhere in the final hero photograph. The front and camera-facing side must be completely uninterrupted except for exact selected displays, controls, sensors, light paths, vents, or mechanisms; do not draw any black oval or rectangular service-port opening there.",
    "Image-quality contract: High-end prototype photography with sharp clean edges, smooth neutral gradients, subtle honest FDM layer texture at correct scale, physically plausible micro-shadows, accurate material response, and crisp separation between adjacent parts. No grain, muddy detail, waxy plastic, fake words, logos, warped geometry, duplicated parts, impossible seams, synthetic CGI gloss, or over-smoothed concept-art surfaces. It should resemble a real finished prototype photographed for a respected design portfolio.",
    `Materials: ${design.materialDirection} Translucency, when allowed by the design brief, is limited to a localized smoke, frosted-clear, or restrained tinted PETG service shell that reveals only exact selected dimension-verified parts; never a dome or decorative bubble. If the exact board count, board geometry, or cable conductor count cannot be preserved, fail closed to an opaque service shell instead of inventing internals.`,
    "UI rule: If a selected display is present, show only abstract pixels, a tiny generic status icon, or a simple pixel face. Never show readable words, brand names, logos, a real app screen, or a physical object protruding from the display.",
    hasContinuousServo
      ? "Power rule: Power and program the ESP32 through USB-C, but treat the selected FS90R servos as a separate regulated 4.8-6V load with common ground. Do not show the ESP32 powering a servo, and do not invent a battery, exposed terminal, motor driver, wall adapter, or magical hidden supply. A simple enclosure cable exit may acknowledge the external low-voltage power path without adding unselected hardware."
      : "Power rule: Treat this as a low-power USB-powered ESP32 prototype. Do not imply a battery unless an exact selected controller or power module supports it. Never show mains wiring, high-current loads, exposed terminals, or magical hidden power.",
    "",
    "Absolute exclusions: no screws; no bolts; no threaded inserts; no visible fastener heads; no visible USB-C port or plug in the hero image; no front-facing connector; no transparent dome; no glass; no acrylic; no decorative clear bubble; no physical mascot; no decorative topper; no floating electronics; no solderless breadboard; no loose decorative wires; no extra board; no camera unless selected; no battery; no unsupported mechanism; no unselected button-like accent patch; no instruction diagram; no neon sci-fi styling; no wooden tabletop; no crowded room scene; no multiple versions; no generic rounded rectangle reused across unrelated projects; no candy-colored primary palette; no children's-toy styling; no arbitrary arch, ring, hole, fin, foot, or color block without a functional rationale.",
  ].join("\n");
}

function renderDesignBrief(idea, plan, parts) {
  const text = `${idea} ${plan.title || ""} ${plan.summary || ""} ${plan.behavior || ""}`.toLowerCase();
  const selectedText = parts.map((part) => `${part.category || ""} ${part.name || ""} ${part.subtype || ""}`).join(" ").toLowerCase();
  const hasMotion = /fs90r|continuous.rotation.*servo|servo.*continuous.rotation/.test(selectedText);
  const hasPositionalServo = /positional.*servo|servo.*(?:90|180|270)[- ]?degree/.test(selectedText)
    && !/fs90r|continuous.rotation/.test(selectedText);
  const hasSelectedCable = parts.some((part) => part.category === "connector" && /cable|dupont|jumper/i.test(`${part.name} ${part.subtype || ""}`));
  const isIntegratedBoard = parts.length === 1 && /display|screen|controller/.test(selectedText);
  const wantsVisibleElectronics = /translucent|transparent|see[- ]through|visible (?:electronics|internals)|show (?:the )?(?:board|wires|electronics)/.test(text);
  const constructionEvidenceUseCase = /prototype|maker|cyberdeck|handheld|tag|dashboard|timer|companion|data instrument/.test(text);
  const hasControllerAndDisplay = parts.some((part) => isControllerPart(part))
    && parts.some((part) => part.category === "display" || /display|screen|lcd|oled|tft|ips/.test(`${part.name} ${part.subtype || ""}`.toLowerCase()));
  const isPlantOrSoilBuild = /(plant|soil(?: moisture)?|planter|garden moisture)/.test(text);
  const hasSoilMoistureSensor = /capacitive.*soil|soil.*moisture|moisture.*(?:sensor|probe)/.test(selectedText);
  let archetype = "purpose-built compact electronic product";
  let formLanguage = "derive a restrained, project-specific silhouette from the use case, interaction face, service path, and verified component envelope; prioritize coherent volumes, disciplined radii, and functional part breaks over novelty geometry";
  let cameraDirection = "eye-level 3/4 front-side documentation view, with the primary affordance readable and the connector side receding away from the viewer";
  let signatureSilhouette = "a concise primary volume with posture and proportions determined by how the project is viewed, held, mounted, or moved; no arbitrary cutout or decorative distortion";
  let delightMoment = "one quiet tactile or visual detail tied to the real interaction—such as a precise bezel, a satisfying control, a subtle status glow, or an honest mechanism reveal";
  let semanticReferenceRule = "- Reference-language rule: treat named design eras or product families as proportions, posture, vent rhythm, and interaction hierarchy—not as a logo, a literal copy, or the nearest current product.";

  if (/pen holder|pencil holder|desk organizer/.test(text)) {
    archetype = "integrated functional desk organizer";
    formLanguage = "make the open pen cup the dominant useful volume, then integrate the exact selected display and control into a low front apron or offset side wing; use a curved mouth, arched feet, and asymmetric stance instead of an A-frame or electronics box";
    signatureSilhouette = "a generous open cup with a sweeping scooped rim, two small arched feet, and one offset interaction wing; the pen-holding void must dominate the black silhouette";
    delightMoment = "make the real pen storage and one supported moving or rotary interaction the focus; use a restrained darker interior so inserted pens complete the composition";
    cameraDirection = "slightly elevated 3/4 front-side view that proves the pen cup is usable while hiding the connector side";
  } else if (/dragon/.test(text)) {
    archetype = "compact dragon-inspired interactive desk object";
    formLanguage = "use a low rounded egg or crouched pebble body with an integrated swept-back printed crest and a wide planted belly; the selected display is the only face, while fins and vents are structural shell geometry rather than separate figurine pieces";
    signatureSilhouette = "a squat asymmetric egg with a curved back and one rhythmic swept crest integrated into the shell, never a tent, wedge, A-frame, or rectangular appliance";
    delightMoment = "let the selected display carry a minimal pixel-dragon expression while a restrained integrated crest gives the enclosure identity without reading as a toy figurine";
    cameraDirection = "low eye-level 3/4 portrait that emphasizes the crouched stance, integrated crest, and selected display while hiding all service ports";
  } else if (/desk pet|desktop pet|companion robot|expressive companion/.test(text)) {
    archetype = "friendly expressive desktop companion";
    formLanguage = "use a compact low body on a recessed stable base, with a gently canted interaction face and one controlled offset shoulder for the exact sensor or control; the selected display is the only face, with no ears, horns, animal shell, A-frame, tent, or arbitrary belly opening";
    signatureSilhouette = "a low compact companion with a forward-canted display face, recessed service base, and one measured shoulder driven by the selected interaction";
    delightMoment = "give the selected display a minimal expressive pixel moment and use a precise shadow-gap snap seam that makes the enclosure feel serviceable";
    cameraDirection = "low eye-level 3/4 product view, showing the selected display and functional posture while hiding every service port";
  } else if (/macintosh|classic mac|compact mac|retro mac(?! mini)/.test(text)) {
    archetype = "1984-era compact Macintosh-inspired desktop appliance";
    formLanguage = "upright one-piece computer posture, tall compact proportions, softly chamfered warm-beige shell, inset dark display opening, subtle rear/side vents, and a quiet lower service band; never a Mac mini slab, laptop, monitor-on-stand, or modern aluminum computer";
    signatureSilhouette = "a compact 1980s all-in-one posture with a subtly convex forehead, narrow shoulders, an inset display, and a gently smiling lower snap-fit service band—clearly upright even as a tiny black silhouette";
    delightMoment = "the tiny selected display becomes the emotional focal point while a single contrasting rotary control feels like a satisfyingly oversized physical dial; no fake floppy slot";
    cameraDirection = "slightly low eye-level 3/4 front-side view that shows the upright compact-computer silhouette and lets the rear connector remain peripheral";
    semanticReferenceRule = "- Macintosh rule: 'Macintosh-inspired' means the original upright compact Macintosh family of the 1980s—vertical posture, inset display, beige molded shell, and restrained vents. It never means Mac mini, iMac, MacBook, Apple logo, a literal replica, or a fake floppy-drive slot unsupported by the selected parts.";
  } else if (/mac mini/.test(text)) {
    archetype = "small desktop-computer-inspired instrument";
    formLanguage = "low compact square desktop footprint with a distinct raised interaction/display feature required by the selected parts; avoid copying Apple hardware or producing an empty featureless slab";
    signatureSilhouette = "a low floating-looking plinth supported by a recessed snap-fit base and one raised interaction island, with the rear connector hidden";
    delightMoment = "a restrained darker underside and precise perimeter shadow gap clarify the snap-fit construction at the three-quarter angle";
  } else if (/robot arm|manipulator|gripper|3[- ]?axis arm/.test(text)) {
    archetype = hasPositionalServo ? "open-frame positional-servo mechanism" : "honest robot-arm control and calibration prototype";
    formLanguage = hasPositionalServo
      ? "expose the real selected positional-servo bodies, printed links, captured pivot pins, cable routing, joint limits, and stable base; do not hide the mechanism in a monolithic enclosure"
      : "show the exact selected controller and controls in a compact calibration stand while omitting any unselected positional arm, servo, gripper, or magical mechanism";
    signatureSilhouette = hasPositionalServo
      ? "a lively articulated S-curve from base to gripper with generous negative space between links and a stable radial foot"
      : "an angled calibration easel with a scooped base and an empty, honest mounting bay that does not pretend an arm exists";
    delightMoment = hasPositionalServo
      ? "use two closely related neutral tones so the motion chain is readable without toy-like color blocking"
      : "make the selected control the tactile hero through scale, color, and a satisfying finger-clearance scoop";
    cameraDirection = "side-biased 3/4 engineering-documentation view that clearly reveals joint architecture or, when actuators are missing, the honest control prototype";
  } else if (/drone|quadcopter|fpv/.test(text)) {
    archetype = "open-frame aerial-electronics prototype";
    formLanguage = "use a purposeful light frame and expose only exact selected boards and routed cables; if motors, propellers, battery, or flight controller are not selected, omit them instead of depicting a complete flyable drone";
    signatureSilhouette = "a compact X or diamond frame with thin swept arms, open negative space, and a small central snap cradle sized only for selected boards";
    delightMoment = "use one restrained orientation accent on the front snap guards so direction is obvious without adding unselected electronics";
    cameraDirection = "slightly elevated 3/4 view with the frame geometry readable against the seamless background";
  } else if (/car|rover|wheeled|vacuum|floor robot|trash sorter/.test(text)) {
    archetype = hasMotion ? "low open-wheel mobile prototype" : "project-specific mobile-object electronics prototype";
    formLanguage = hasMotion
      ? "a narrow H-shaped or T-shaped printed structural spine with large negative space around two visibly nested FS90R servo bodies, exactly two outboard wheels on one axle line, a small snap-fit electronics pod only where needed, honest wheel clearance, and no broad rectangular lid, sealed shoebox body, cosmetic body kit, or featureless slab"
      : "preserve the recognizable requested object but show no powered drivetrain, hidden wheel, or invented mechanical hardware";
    signatureSilhouette = hasMotion
      ? "a low-slung bow-tie structural chassis: two outboard wheels, a narrow load-bearing waist, real motion clearance under the center spine, and a compact electronics pod—not a car-shaped box"
      : "a recognizable static object profile with one large purposeful cutout and no fake drivetrain";
    delightMoment = hasMotion
      ? "use a subtly contrasting snap-on center spine and covered wheel retainers so the drive geometry reads clearly while remaining mechanically honest"
      : "use a confident accent snap panel that clearly signals the beginner-serviceable area";
    cameraDirection = "low 3/4 front-side engineering view that shows wheel alignment or the honest static adaptation without pointing USB-C at the camera";
  } else if (/rubik|cube/.test(text)) {
    archetype = "display-tile cube study";
    formLanguage = "preserve the requested cube as the honest primary archetype, but show only the exact selected display area on one visible face unless multiple display modules are selected; use deep rounded edge channels, offset colored corner bumpers, and a snap-fit split that evokes movable tiles without inventing screens";
    signatureSilhouette = "a compact softened cube with deep rhythmic face channels and contrasting corner protection; this is the one intentional exception to the non-box silhouette rule because the user explicitly requested a cube";
    delightMoment = "use a restrained Rubik-inspired set of desaturated face accents while the one real display shows only abstract pixels";
  } else if (/handheld|controller|console|game|player|remote|tag|wearable|portable/.test(text)) {
    archetype = "handheld or compact interactive instrument";
    formLanguage = "interaction-first front face, comfortable edge radii, purposeful control spacing, slim snap-fit rear shell, and a side/rear connector; use a measured grip relief, offset thumb bay, cartridge shoulder, or curved back only where ergonomics require it";
    signatureSilhouette = "a compact soft dog-bone or rounded-cartridge outline with one side scooped for the hand and the interaction face visually balanced by asymmetry";
    delightMoment = "let one supported control or selected display become the precise focal point, with a subtle material change at the snap-fit rear shell";
  } else if (/vinyl|turntable|music player/.test(text)) {
    archetype = "miniature digital turntable-inspired controller";
    formLanguage = "organize the exact display and rotary control around a broad circular recessed platter motif on an asymmetric low deck with a curved front corner; no A-frame, tent, rectangular receiver, or fake tonearm";
    signatureSilhouette = "a low asymmetric kidney-shaped deck with one dominant circular platter recess and a clipped control corner";
    delightMoment = "the selected rotary control becomes the satisfyingly oversized platter interaction, accented like a tiny record without adding a fake mechanism";
  } else if (/message board|couple companion|send messages/.test(text)) {
    archetype = "tabletop message display";
    formLanguage = "mount the exact selected display in a thin, correctly proportioned frame on one integrated rear kickstand or weighted base; keep the body shallow and serviceable, with no portal ring, decorative void, A-frame tent, or oversized empty shell";
    signatureSilhouette = "a thin canted display frame with a single functional rear support and a low center of gravity";
    delightMoment = "a restrained inner bezel and soft status glow make each incoming abstract drawing feel considered without decorative geometry";
  } else if (/json|csv|table viewer|data input|dashboard|info panel/.test(text)) {
    archetype = "professional desktop data instrument";
    formLanguage = "use a folded-ribbon side profile, cantilevered display deck, and open underside with a small weighted foot; avoid an A-frame, tent, slab, or generic monitor";
    signatureSilhouette = "an offset cantilevered ribbon: display deck projecting from a curved spine above a clearly open base";
    delightMoment = "a high-contrast underside color reveal makes the display feel like it is being presented, without floating or adding supports";
  } else if (/timer|alarm clock|clock/.test(text)) {
    archetype = "friendly timekeeping object";
    formLanguage = /alarm/.test(text)
      ? "use a low bridge clock with a shallow viewing tilt, two short stable feet, and the exact display centered under a functional glare brow; no tent or oversized filled rectangle"
      : "use a compact weighted timer body with an integral rear viewing stand, correctly proportioned display, and one exact control in a comfortable reach zone; no loop, hourglass, ring, A-frame, or arbitrary void";
    signatureSilhouette = /alarm/.test(text)
      ? "a low smiling bridge with daylight beneath the display and two planted feet"
      : "a concise timer body canted on one integrated rear support, with its display and exact primary control forming a clear hierarchy";
    delightMoment = "use the selected button, touch area, or rotary control as one precisely detailed time interaction with a restrained accent";
  } else if (!/plant|soil|water|door|window|air|light|sensor|monitor|chime/.test(text)
    && /clock|timer|message board|dashboard|display|status|music|vinyl/.test(text)) {
    archetype = "desktop information instrument";
    formLanguage = "a compact upright instrument or shallow canted console chosen for viewing angle, with a correctly proportioned display bezel, clear primary/secondary controls, an integrated rear support, a quiet service seam, and no oversized empty body";
    signatureSilhouette = "a shallow canted interaction plane supported by one integrated rear spine or recessed base, with proportions driven by the exact display and controls";
    delightMoment = "a precise inner bezel or subtle underside material change frames the selected display without bright color blocking";
  } else if (isPlantOrSoilBuild && hasSoilMoistureSensor) {
    archetype = "single-piece soil-insertable plant instrument";
    formLanguage = "use one slim upright display/controller head above the soil and one selected flat capacitive sensing blade extending directly below it, joined by a narrow protected neck and an overhanging soil-stop shoulder; cant the portrait TFT face slightly upward for reading, keep the body compact, and use no separate station, detached probe, external harness, leaf silhouette, decorative pot, or cable loop";
    signatureSilhouette = "one continuous vertical soil stake: compact tapered portrait-display head, protective shoulder at the soil line, narrow central neck, and one real flat sensing blade below—never two devices";
    delightMoment = "use the portrait TFT as the crisp focal point with a restrained moisture bar and droplet pixels, plus one localized smoke-gray rear-quarter service strip that explains the exact selected electronics without becoming a transparent shell";
    cameraDirection = "slightly elevated 3/4 front-side industrial-design documentation view showing the portrait display, slim depth, receding service strip, protective shoulder, and selected sensing blade entering a small soil test vessel while every connector remains hidden";
  } else if (/plant|soil|water|door|window|air|light|sensor|monitor|chime/.test(text)) {
    archetype = "environment-specific sensing fixture";
    formLanguage = /window|air/.test(text)
      ? "use a low horizontal breathing bridge with a large open arch beneath it, two short feet, a gently bowed vented canopy, and the exact display integrated into one end; never an upright A-frame, tent, wedge, or filled box"
      : /door|chime/.test(text)
        ? "use a slim vertical pebble with one offset shoulder that nestles against a wall or door frame; keep the exact display, sensor zone, or light path small and clear, with no front service-port opening"
        : "use a slim crescent mount, soft arch, purposeful clip, petal diffuser, or tapered freestanding fixture chosen for the place it works; align vents, light paths, probes, and sensor apertures with the actual environment instead of using a generic desktop box";
    signatureSilhouette = /plant|soil/.test(text)
      ? "a compact upright above-soil environmental stake with a readable interaction head and no invented sensing blade or separate probe"
      : /water/.test(text)
        ? "a low stable sensing fixture shaped around the verified water-facing sensor path, without decorative liquid motifs"
      : /door|chime/.test(text)
        ? "a slim vertical pebble with one offset shoulder that nestles against a wall or door frame and keeps the interaction face clear"
        : /light/.test(text)
          ? "a shallow radial petal or folded-ribbon diffuser supported by a tiny recessed sensor base, using only the selected light source"
          : "a breathable bridge-like shell with a large central arch and purposeful vent rhythm around the verified sensor path";
    delightMoment = "use a restrained accent only on the real status light path or service seam so the fixture feels considered rather than clinical";
    if (/door|chime/.test(text)) {
      cameraDirection = "straight-on front view of the fixture mounted flush to a plain studio wall, with zero visible side or rear surface; show only the exact selected display or status light on the front and show no USB opening, plug, loose cable, pigtail, magnetic-sensor opening, or service cutout";
    }
  }

  let visibilityStrategy = "use an opaque shell and reveal only the selected screen, control, sensor aperture, or light path required for operation";
  const colorStory = professionalColorStory(text);
  let materialDirection = `Use tactile matte FDM plastic with the ${colorStory} palette: one dominant neutral, one secondary neutral, and a single restrained accent on no more than 5-10% of the form. The accent must follow a real bezel, snap seam, structural member, or selected light path; never draw an isolated control-sized color patch that could be mistaken for a button. Preserve subtle real layer lines and use no metal enclosure fasteners.`;
  if (/robot arm|manipulator|drone|quadcopter|fpv/.test(text)) {
    visibilityStrategy = "use an honest open-frame construction: exact selected boards, actuators, and factory-terminated cables may remain visible where mechanically necessary; do not fabricate missing electronics";
    materialDirection = `Use matte printed structural parts in the ${colorStory} palette, alternating dominant and accent colors to make the mechanism legible; exact selected modules provide the only non-printed material detail. No cosmetic outer shell and no screws.`;
  } else if ((wantsVisibleElectronics || constructionEvidenceUseCase || (isPlantOrSoilBuild && hasSoilMoistureSensor)) && (hasSelectedCable || isIntegratedBoard || hasControllerAndDisplay)) {
    visibilityStrategy = "use one localized smoke or softly tinted translucent PETG service panel on the receding side or rear quarter, limited to roughly 20-35% of the body, to explain the exact selected board, connector orientation, and any selected factory-terminated cable; keep the main interaction face opaque and legible, avoid a dome or capsule, and fail closed to opaque if exact internals cannot be preserved";
    materialDirection = `Combine a matte opaque primary shell in the ${colorStory} palette with one restrained smoke, amber, or frosted translucent PETG service panel of believable thickness and straight snap-fit edges; show only exact selected internals, with plausible wire bend radii and no decorative cable runs.`;
  }

  return {
    archetype,
    formLanguage,
    visibilityStrategy,
    connectorPlacement: "recess USB-C on the unseen rear or underside with strain relief and cable bend clearance; choose the hero angle so the port is completely hidden, never on the front interaction face and never pointed toward the viewer. Do not depict the USB-C shape at all in the hero image",
    cameraDirection,
    materialDirection,
    signatureSilhouette,
    delightMoment,
    colorStory,
    semanticReferenceRule,
  };
}

function professionalColorStory(text) {
  const palettes = [
    "warm off-white, graphite, and a restrained burnt-orange accent",
    "soft bone, charcoal, and a muted cobalt accent",
    "cool gray, matte black, and a subdued amber accent",
    "stone gray, deep navy, and a desaturated sage accent",
    "warm gray, dark plum, and a restrained coral accent",
    "matte black, smoke gray, and a pale blue status accent",
  ];
  let value = 0;
  for (const character of text) value = ((value * 31) + character.charCodeAt(0)) >>> 0;
  return palettes[value % palettes.length];
}

export function publicBuild(build) {
  return {
    id: build.id,
    createdAt: build.createdAt,
    title: build.title,
    idea: build.idea,
    summary: build.summary,
    behavior: build.behavior,
    visibleHardwareCues: build.visibleHardwareCues || [],
    image: build.image,
    parts: build.parts,
    warnings: build.warnings || [],
    cost: build.cost,
    status: build.status || "Concept",
  };
}

function publicPart(part) {
  const listingPrice = typeof part.price === "number" ? part.price : null;
  const unitPriceUsd = listingPrice ?? planningPrice(part.category);
  return {
    id: part.id,
    name: part.name,
    category: part.category,
    subtype: part.subtype,
    price: listingPrice,
    unitPriceUsd,
    priceSource: listingPrice == null ? "planning-estimate" : "listing",
    priceLabel: listingPrice == null
      ? `About $${unitPriceUsd.toFixed(2)} planning estimate`
      : `$${listingPrice.toFixed(2)} catalog price`,
    packQty: part.packQty,
    asin: part.asin,
    url: part.url,
    voltage: part.voltage,
    notes: part.notes,
    why: part.why,
    checkedDate: part.checkedDate,
    presoldered: part.presoldered,
  };
}

function planningPrice(category) {
  return {
    controller: 14.99,
    display: 9.99,
    sensor: 7.99,
    input: 6.99,
    output: 6.99,
    actuator: 12.99,
    connector: 6.99,
    storage: 8.99,
    time: 7.99,
    power: 19.99,
  }[category] || 7.99;
}

function isControllerPart(part) {
  if (part.category === "controller") return true;
  const text = `${part.name || ""} ${part.subtype || ""}`.toLowerCase();
  return /\bxiao\s+esp32/.test(text)
    || /\besp32(?:-[a-z0-9]+)?\b.{0,90}(?:dev(?:elopment)? board|mini|wroom|camera|lora)/.test(text)
    || /(?:dev(?:elopment)? board|mini|wroom|camera|lora).{0,90}\besp32(?:-[a-z0-9]+)?\b/.test(text);
}

function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("");
}

function openAIHeaders(env) {
  return {
    Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function openAIEndpoint(env, pathname) {
  return `${openAIBaseUrl(env)}${pathname}`;
}

function openAIBaseUrl(env) {
  const raw = String(env.OPENAI_BASE_URL || "https://api.openai.com").trim().replace(/\/+$/, "");
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") throw buildGenerationError("The OpenAI endpoint must use HTTPS.");
  return parsed.toString().replace(/\/+$/, "");
}

function usesDirectOpenAI(env) {
  return new URL(openAIBaseUrl(env)).hostname === "api.openai.com";
}

function openAIRequestPayload(payload, env) {
  if (usesDirectOpenAI(env)) return payload;
  const gatewayPayload = { ...payload };
  delete gatewayPayload.service_tier;
  return gatewayPayload;
}

function openAITimeoutSignal(env) {
  const requested = Number.parseInt(env.OPENAI_IMAGE_TIMEOUT_MS, 10);
  const timeoutMs = Number.isFinite(requested)
    ? Math.max(30_000, Math.min(requested, 840_000))
    : 720_000;
  return AbortSignal.timeout(timeoutMs);
}

function buildGenerationError(message) {
  const error = new Error(String(message || "Build generation failed."));
  error.code = "build_generation_failed";
  return error;
}

function openAIServiceTier(env) {
  const tier = String(env.OPENAI_BUILD_SERVICE_TIER || env.OPENAI_SERVICE_TIER || DEFAULT_BUILD_SERVICE_TIER).toLowerCase();
  return ["auto", "default", "flex", "priority"].includes(tier) ? tier : DEFAULT_BUILD_SERVICE_TIER;
}

function imageQuality(value) {
  const quality = String(value || DEFAULT_IMAGE_QUALITY).toLowerCase();
  return ["low", "medium", "high"].includes(quality) ? quality : DEFAULT_IMAGE_QUALITY;
}

function loadCatalog() {
  const rows = parseCsv(catalogCsv);
  const header = rows[0] || [];
  return rows
    .slice(1)
    .map((row, index) => normalizeCatalogPart(Object.fromEntries(header.map((key, column) => [key, row[column] || ""])), index))
    .filter((part) => part.presoldered);
}

function normalizeCatalogPart(row, index) {
  const asin = clean(row.asin);
  const name = clean(row.part_name || row.subcategory_or_subtype || row.listing_title || `Part ${index + 1}`);
  const listingTitle = clean(row.listing_title || name);
  const price = parsePrice(row.estimated_price_usd);
  const id = `${asin || hash(`${name}-${index}`).slice(0, 10)}-${index + 1}`.toLowerCase();
  const advancedText = `${row.category} ${row.subcategory_or_subtype} ${name} ${listingTitle}`.toLowerCase();
  const verificationText = `${row.visual_status} ${row.verification_status} ${row.visual_pass_evidence} ${row.pin_source_evidence}`;
  const readyToUseException = /exception_factory_crimped_assembled|not_applicable_factory_attached_3pin_female_servo_plug/i.test(row.factory_presoldered_male_pins_verified)
    && /visual_pass/i.test(verificationText);
  const verifiedContinuousServo = /\bfs90r\b/.test(advancedText)
    && /continuous[- ]rotation/.test(advancedText)
    && /factory_attached_servo_lead/i.test(verificationText)
    && /external_servo_power_required/i.test(row.exclusion_flags);
  const excludedAdvancedPart = /(max485|rs-485|mosfet|12v|24v|36v|buck|mcp23017|gpio expander|level shifter|shift register|diode|relay|pump|heater|mains|high[ -]?current|battery cell)/.test(advancedText);
  const unsupportedMotor = /motor|servo|powered wheel/.test(advancedText) && !verifiedContinuousServo;
  const excludedForPlanning = excludedAdvancedPart || unsupportedMotor;
  const electricalText = `${row.esp32_voltage} ${name} ${listingTitle}`.toLowerCase();
  const fiveVoltOnly = /\b5(?:\.0)?v\b/.test(electricalText)
    && !/\b3(?:\.0|\.3)?v\b/.test(electricalText);
  const weirdAuditRow = /visual_pass_factory|^yes$/i.test(name);
  const presoldered = clean(row.factory_presoldered_male_pins_verified).toLowerCase() === "yes"
    || readyToUseException
    || /visual_pass_factory_presoldered|pre-?soldered|presoldered/i.test(verificationText);
  const checkedDate = clean(row.last_checked_yyyy_mm_dd);
  const hasVerifiedCheckedDate = /^\d{4}-\d{2}-\d{2}$/.test(checkedDate);

  return {
    id,
    sourceMarketplace: clean(row.source_marketplace),
    category: normalizeCategory(row.category, name, listingTitle),
    subtype: clean(row.subcategory_or_subtype),
    name,
    listingTitle,
    brand: clean(row.brand_or_seller),
    price,
    priceLabel: price == null ? clean(row.estimated_price_usd) || "Live price check needed" : `$${price.toFixed(2)}`,
    packQty: Number.parseInt(row.pack_qty, 10) || 1,
    asin,
    url: clean(row.direct_url),
    voltage: clean(row.esp32_voltage),
    notes: clean(row.current_or_power_notes),
    why: clean(row.why_include),
    checkedDate,
    visualStatus: clean(row.visual_status),
    verificationStatus: clean(row.verification_status),
    presoldered,
    modelSelectable: presoldered && hasVerifiedCheckedDate && !excludedForPlanning && !fiveVoltOnly && !weirdAuditRow,
  };
}

function normalizeCategory(category, name, title) {
  const sourceCategory = clean(category).toLowerCase();
  const productText = `${name} ${title}`.toLowerCase();
  const integratedEsp32Board = /\besp32(?:-[a-z0-9]+)?\b.{0,90}(?:dev(?:elopment)? board|mini|wroom|camera|lora)/.test(productText)
    || /(?:dev(?:elopment)? board|mini|wroom|camera|lora).{0,90}\besp32(?:-[a-z0-9]+)?\b/.test(productText);

  // The curated sheet already carries a useful product class. Prefer it over
  // compatibility phrases in listing titles (for example, a BME280 sensor
  // saying "for ESP32" must not become a controller, and an ambient-light
  // sensor must not become an LED output).
  if (/^(?:dev_board|esp32 boards)$/.test(sourceCategory)) return "controller";
  if (sourceCategory === "display" && integratedEsp32Board) return "controller";
  if (sourceCategory === "display") return "display";
  if (sourceCategory === "input") return "input";
  if (sourceCategory === "output") return "output";
  if (sourceCategory === "actuator") return "actuator";
  if (sourceCategory === "connector") return "connector";
  if (sourceCategory === "storage") return "storage";
  if (sourceCategory === "time") return "time";
  if (sourceCategory === "power") return "power";
  if (/sensor|temperature|humidity|pressure|motion|imu|color_light/.test(sourceCategory)) return "sensor";
  if (sourceCategory === "board" && integratedEsp32Board) {
    return "controller";
  }

  if (/display|oled|lcd|screen/.test(productText)) return "display";
  if (/\bxiao\b|\besp32(?:-[a-z0-9]+)?\b.*(?:dev(?:elopment)? board|mini|wroom|camera|lora)/.test(productText)) return "controller";
  if (/button|keypad|joystick|encoder|potentiometer|touch|microphone|sound/.test(productText)) return "input";
  if (/buzzer|\bled\b|motor/.test(productText)) return "output";
  if (/connector|qwiic|usb to ttl/.test(productText)) return "connector";
  if (/storage|sd card|flash/.test(productText)) return "storage";
  if (/rtc|clock|time/.test(productText)) return "time";
  if (/power|lipo|battery|charger/.test(productText)) return "power";
  return "sensor";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parsePrice(value) {
  const match = String(value || "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function sanitizeIdea(value) {
  const idea = clean(value).slice(0, 280);
  return idea.length >= 4 ? idea : "";
}

function sanitizeEmail(value) {
  const email = clean(value).toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function newBuildId(idea) {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${slug(idea).slice(0, 42)}-${randomId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}

function safeBuildId(id) {
  return /^[a-z0-9][a-z0-9-]{4,80}$/i.test(String(id || ""));
}

function buildStoreKey(id) {
  if (!safeBuildId(id)) throw new Error("Invalid build id.");
  return `builds/${id}.json`;
}

function readableTitle(title, idea) {
  const source = clean(title) || clean(idea);
  const words = source
    .replace(/[^a-z0-9\s-]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  const leadingFillers = new Set(["a", "an", "the", "make", "build", "create"]);
  while (words.length > 2 && leadingFillers.has(words[0].toLowerCase())) words.shift();
  words.splice(5);
  const trailingFillers = new Set(["a", "an", "and", "for", "in", "of", "the", "to", "with"]);
  while (words.length > 2 && trailingFillers.has(words.at(-1).toLowerCase())) words.pop();
  const result = words.map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase()).join(" ");
  return result || "Makeable Build";
}

function cleanSentence(value, maxLength = 420) {
  const sentence = clean(value);
  if (sentence.length <= maxLength) return sentence;

  const candidate = sentence.slice(0, maxLength + 1);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
  );
  if (sentenceEnd >= Math.floor(maxLength * 0.55)) {
    return candidate.slice(0, sentenceEnd + 1);
  }

  const wordEnd = candidate.lastIndexOf(" ");
  const cutoff = wordEnd >= Math.floor(maxLength * 0.75) ? wordEnd : maxLength;
  return `${candidate.slice(0, cutoff).replace(/[,:;\s]+$/, "")}…`;
}

function cleanStringArray(value, fallback) {
  const array = Array.isArray(value) ? value : fallback;
  return array.map((item) => cleanSentence(item)).filter(Boolean).slice(0, 8);
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "build";
}

function hash(value) {
  // FNV-1a is sufficient here because the hash only chooses a deterministic
  // fallback artwork; it is not used for authentication or integrity.
  let result = 0x811c9dc5;
  for (const char of String(value)) {
    result ^= char.codePointAt(0) || 0;
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, "0").repeat(8);
}

function fallbackImageForIdea(idea) {
  const index = Number.parseInt(hash(idea).slice(0, 2), 16) % fallbackImages.length;
  return fallbackImages[index];
}
