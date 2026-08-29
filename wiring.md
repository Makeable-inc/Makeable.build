# Makeable: AWS-only Assembly Generation Workflow

This is the reusable workflow for generating a Makeable project, its cloud-backed 3D assembly guide, wiring plan, firmware, and hero image. It captures the successful plant-companion benchmark and the quality constraints learned from the earlier poor result.

## Production prompt routing

The runtime source of truth is the versioned prompt package at `prompts/production/manifest.json`. This document explains the larger system; it is never sent wholesale to a model.

| Stage | Owner | Runtime prompt | Purpose |
| --- | --- | --- | --- |
| `parts_plan` | `gpt-5.6-terra` | `prompts/production/parts-planner.md` | Select or normalize one exact catalog-constrained build plan. |
| `asset_resolution` | Registry service | None | Verify immutable AWS assets, hashes, interfaces, and nodes in code. |
| `assembly_routing` | `gpt-5.6-sol` | `prompts/production/assembly-routing.md` | Return bounded lane, direction, and bow metadata for immutable wires. |
| `route_geometry` | Deterministic geometry | None | Build and validate connector-normal, no-loop geometry. |
| `hero_art_direction` | `gpt-5.6-sol` | `prompts/production/hero-art-director.md` | Produce one exact product-hero prompt. |
| `hero_image` | `gpt-image-2` | Output of `hero_art_direction` | Render one illustrative hero with no inspection or correction pass. |
| `housing_generation` | Deterministic CAD | None | Generate and validate the housing from locked dimensions. |
| `firmware_generation` | Deterministic firmware template/compiler | None | Generate and compile firmware for the locked board and pin map. |
| `browser_delivery` | Three.js renderer | None | Hash-verify and render accepted AWS GLBs and route geometry. |

Each Responses API call receives only its stage-specific developer instructions. Dynamic user/build data is supplied separately. JSON Schemas remain code-owned Structured Output configuration rather than prompt prose. Registry gates, geometry gates, compiler gates, mesh gates, and browser machine-state gates are deterministic validation—not model prompts and not visual passes.

## Product outcome

Given a user request such as “build me a smart plant monitor,” Makeable should return:

1. an exact, purchasable parts list;
2. a validated wiring/assembly contract using only approved AWS-hosted assets;
3. a browser assembly guide rendered from those GLBs;
4. firmware and beginner instructions; and
5. a high-quality hero image that depicts the same selected kit.

The live product must **not** generate meshes, inspect assets, or silently fall back to local GLBs during a user build. Asset research, GLB reconstruction, visual QA, registry publishing, and catalog reconciliation are offline catalog-maintenance work.

## Non-negotiable runtime rules

- Resolve parts from the catalog by exact SKU, ASIN, AliExpress key, or manufacturer part number. Do not replace an exact part with a visually similar board.
- Fetch all GLB, STEP, STL, thumbnail, and review evidence through immutable HTTPS URLs in the AWS/CloudFront registry.
- Reject a missing asset, incorrect SHA-256, unexpected CloudFront origin, missing required anchor, missing approved revision, or any asset whose `visualEligibility`, `interfaceEligibility`, or `selectionStatus` is not `ready`. Show the deterministic 2D fallback rather than a guessed 3D substitute.
- The wiring model may choose only presentation routing. It cannot move parts, invent endpoints, add wires, alter pin labels, or change electrical topology.
- Physical placements, named GLB pin nodes, wire inventory, electrical roles, and connection-surface tie points come from the immutable assembly contract. A renderer must never replace a missing pin node with a guessed coordinate near the controller.
- A controller USB-C receptacle is a forbidden wire endpoint unless the immutable contract explicitly selects a USB cable. Sensor power, ground, bus, and GPIO leads must land on the declared contact of the exact `connectionSurfacePartId`—not on the controller body, USB shell, or a visually convenient nearby point.
- Do not use “breadboard” as a generic name for an expansion carrier. The contract must declare `connectionSurfaceKind` as exactly `solderless-breadboard`, `expansion-carrier`, `breakout-board`, or `controller-header`. If the selected build contains no physical solderless breadboard, no wire may target a breadboard row or rail.
- Keep `OPENAI_API_KEY` server-side. Never place it, a registry credential, or an AWS credential in client JavaScript, browser logs, telemetry, or prompts.

## Runtime architecture

```text
User prompt + Google sign-in
             |
             v
Terra 5.6: exact part selection and build plan
             |
             +---------------------+----------------------+
             |                     |                      |
             v                     v                      v
AWS registry lookup       firmware/code generation   Sol 5.6 hero art direction
             |                     |                      |
             v                     |                      v
Immutable GLB manifests   |                 gpt-image-2, high quality
             |                     |                      |
             +-----------> immutable assembly contract <---+
                                |
                                v
               Sol 5.6: bounded presentation metadata only
                                |
                                v
      browser fetches CloudFront GLBs, verifies SHA-256, renders assembly
```

The GLB registry request and the hero-image branch run concurrently after parts are selected. The assembly guide must be available independently of the hero render; the hero is a progressive enhancement and cache candidate.

## Model responsibility boundaries

| Stage | Owner | Allowed work | Forbidden work |
| --- | --- | --- | --- |
| Part picking | `gpt-5.6-terra` | Select exact catalog parts, explain selection, identify an approved assembly recipe | Invent a part, choose an unapproved variant, alter asset metadata |
| Asset resolution | Registry service | Map selected catalog IDs to immutable CloudFront manifest/GLB revisions and hashes | Local-file fallback, fuzzy match, unsigned URL |
| Mechanical placement | Deterministic assembly contract | Apply approved mounted/exploded transforms and breadboard datum alignment | LLM-generated poses or unverified collision claims |
| Wiring presentation | `gpt-5.6-sol` with high reasoning | Pick a shallow bow direction, lane, and height for each already-validated wire | Add/remove/reinterpret wires, endpoints, pins, voltages, breadboard rows, or part placement |
| Hero art direction | `gpt-5.6-sol` with high reasoning | Write a compact, part-specific image prompt from the selected kit | Omit selected parts or depict a different board/wiring topology |
| Hero pixels | `gpt-image-2`, `high` | Render the concept image | Act as a wiring source of truth |
| Browser | Three.js/R3F renderer | Download, SHA-check, render known assets and routes | Trust arbitrary URLs or model-authored geometry |

## Geometry and connection-surface seating invariants

The source contract and CAD assets use a right-handed **Z-up** coordinate convention. Three.js is **Y-up**. Convert the *entire scene* consistently:

```text
contract [x, y, z]  ->  Three.js [x, z, -y]
```

Apply that conversion to models, pin anchors, wire control points, callouts, and camera targets. Applying it to models alone causes the classic failure mode: a vertical breadboard, floating modules, and wires apparently routed through space.

For breadboard-mounted parts:

- Seat against the approved breadboard top datum, using the manifest’s named pin-tip/support datum.
- The current plant pilot uses 5 mm nominal pin insertion for suitable male header pins.
- Verify at build time that each contact has a named GLB node, a finite transform, the expected revision/hash, and a valid tie point.
- Visual seating proof confirms the specified nodes align with the breadboard datum. It does **not** claim whole-mesh collision, insertion force, solder strength, or electrical continuity.
- Never “stick” a component onto a breadboard just to make an image look occupied. The placement must correspond to its pin pitch, header orientation, connector clearance, and selected tie-point plan.

For expansion carriers, GPIO breakout boards, and direct pin-to-pin builds:

- The carrier or breakout is the authoritative wiring surface. The controller seated in its sockets is not a substitute wiring surface.
- The contract must lock `connectionSurfacePartId`, `connectionSurfaceKind`, and `controllerMountPartId`. For an ESP32-C3 Super Mini seated on its matching expansion carrier, all sensor leads originate on the carrier's named breakout pins; the controller USB-C is only a mechanical/service feature.
- Every endpoint record must include `partId`, `connectorId`, `nodeName`, `physicalPinLabel`, connector gender/family, and the node normal. The named GLB pin node must be a descendant of the declared source part and connector.
- Resolve the named node only after the final approved part transform is applied. Use the resolved world transform for the pin tip and normal; never use a guessed world coordinate, board centroid, or camera-relative offset.
- Reject an endpoint if its node is absent, duplicated, outside the declared connector bounds, inside the controller/USB-C keepout, or on a connector whose gender cannot mate with the selected lead.
- A direct female Dupont connection needs visible termination geometry. One individual female Dupont sleeve must overlap the physical male-pin shank, and the wire must emerge from the rear center of that sleeve. The first and last route segments must follow the connector normal before beginning the flexible bow.
- Sensor-side endpoints must resolve both the physical male-pin mesh and the physical PCB/core mesh, not a pad-centre anchor or an inferred point. After the final part transform, measure the pin's exposed shank beyond both PCB faces along the board-normal axis: `topExposure = max(0, pinMax - pcbTop)` and `undersideExposure = max(0, pcbBottom - pinMin)`.
- Deterministically select the side with the longer usable exposed shank. A top-side header uses the top pin tip and outward `+boardNormal`; an underside header uses the bottom pin tip and outward `-boardNormal`. Place the female sleeve on that selected side and make the wire exit farther away from the PCB before it bends.
- Fail closed if the winning exposure is below 1.5 mm, the top/bottom difference is below 1.0 mm, the normalized confidence is below 0.25, either physical mesh is missing, or the transformed bounds are invalid. Sol never selects, overrides, or visually guesses the mating side.
- Never route a lead into the decorative pad, silkscreen label, solder joint, plastic header body, or either PCB face. Approved catalog QA must confirm that male-pin and PCB meshes represent the purchased header orientation; runtime classification can only be as correct as the immutable GLB geometry.
- Treat readable silkscreen as an annotation layer, independent from the physical board and connector orientation. Every sensor title, signal name, voltage label, and pinout label must lie on the PCB top face with text normal `+boardNormal` and a canonical text-up vector aligned to the assembly front.
- Never flip, mirror, rotate, or relocate the PCB, male pins, sleeves, components, or wiring endpoints to correct text. If approved native text is missing, mirrored, underneath, or oriented away from the top, the deterministic renderer may add only a top-face title/pinout annotation; it must not change physical geometry or electrical connectivity.
- Text/pinout overlays must be generated from locked catalog labels and pin names, not Sol prose. They must record `partId`, layer type, exact text, top-face normal, text-up vector, and `affectsPhysicalGeometry: false`. Native microphone text may be preserved when catalog QA already verifies it as top-facing.
- For replicated carrier rails, allocate a distinct physical male pin to every sensor lead. Sharing an electrical net does not permit multiple rendered wires to originate from the same visible pin unless the selected physical connector explicitly supports it.

Controller-family compatibility is exact and non-inheritable:

- Pre-soldered Seeed XIAO ESP32C3/S3 variants may connect one or two sensors directly through verified individual female sockets. Only the exact Seeed XIAO Expansion Board/Base may expose its declared Grove/Qwiic-class keyed interfaces.
- An ESP32-C3 Super Mini requiring three or more sensors must use the exact approved C3 Super Mini carrier. Its carrier endpoints, polarity, sockets, and GPIO rails must come from that carrier's own ready interface profile. It has no implied Qwiic, Grove, or other quick-connector capability.
- A long 44-pin ESP32-S3 DevKit requiring three or more sensors must use the exact approved 44-pin S3 carrier. It cannot use a C3 Super Mini or XIAO carrier, and it inherits no connector capability from either family.
- The C3 carrier is production-selectable only with the immutable mount contract `2x8 + usb_c_toward_power_block` and restricted power contract `controller_usb_c + 3.3V peripherals + no external carrier power + no battery + no rail modification`. Missing or changed fields fail closed.
- The 44-pin S3 carrier is production-selectable only with the immutable mount contract `2x22 + usb_c_aligned_with_carrier_arrow` and restricted power contract `controller_usb_c + 3.3V peripherals + no external carrier power + no DC barrel + no 5V peripheral rail`. Missing or changed fields fail closed.
- A carrier with `candidate_review` or `interfaceEligibility != ready` is blocked from production selection even when a visually similar GLB exists.

## Wiring appearance standard

The previous bad output used tall, angular, plumbing-like lines. The production visual standard is a compact flexible jumper.

- Each connection is one open smooth cubic Bézier bow from its verified named GLB pin node to its verified target pin node.
- Preserve exact endpoints. Only the intermediate bow can change.
- Default bow height: **4–7 mm above the breadboard plane**.
- Give adjacent wires small, deterministic lateral lane offsets so red/black/blue/yellow/green wires do not collapse into a single line.
- Use about 12 sampled points per cubic curve; use a thin round tube/line with a small active-step highlight.
- Completed wires remain visible but subdued. The active wire and both endpoints remain clear.
- Cable loops are categorically forbidden, including service loops and coils used to consume excess cable length. Never generate a circle, closed turn, repeated traversal, overlap, knot, or self-intersection. The route may be straight, gently bent, or asymmetrically bowed, but it must remain one open path.
- Avoid squared corners, 90-degree conduits, extreme arches, random crossing, opaque bundles, or tubes thicker than the pins.
- Wire color is helpful but never the sole cue: label every connection with its exact signal and pin name.
- Accept a route only after deterministic geometry proves pin/sleeve overlap, centreline exit along the connector normal, required bend radius, cable-length feasibility, zero closed loops, zero self-intersections, and zero keepout intersections. Do not use a visual correction pass to enforce this rule. An endpoint magnifier may display an already accepted result, but it is never a production decision gate and never triggers a correction pass.

## Terra 5.6 prompt: exact part selection

Use this server-side system/developer prompt template after replacing the bracketed values:

```text
You are Makeable's exact-parts planner. Convert the user's project request into a safe, buildable plan using only items returned by the approved catalog/registry context.

User request:
[USER_REQUEST]

Approved catalog candidates, including exact buy variants, connector population, interface capabilities, CloudFront asset availability, and compatibility constraints:
[CATALOG_CONTEXT]

Rules:
1. Select only exact catalog IDs presented in the context. Never fabricate, fuzzy-match, or substitute a board.
2. Prefer the no-solder buy variant with installed male headers, female headers, a keyed plug, or another stated no-solder mating path when the catalog explicitly says it is supplied.
3. Satisfy voltage, GPIO, I2C/SPI/UART, ADC, power, and breadboard constraints using the supplied facts only.
4. Return a concise bill of materials, a reason for each selection, and an assembly recipe ID. Identify uncertainty explicitly instead of guessing.
5. Do not create wiring positions, wire routes, GLB URLs, image prompts, or firmware source. Those stages happen after exact parts are locked.

Return JSON matching the provided schema only.
```

## Sol 5.6 prompt: assembly wiring presentation

Call Sol only after the deterministic assembly contract has locked assets, placements, electrical graph, and endpoints.

```text
You are Makeable's presentation-routing specialist for a beginner electronics assembly guide.

You may improve ONLY the visual route plan for the already validated wires. Every part transform, wire ID, source named GLB pin node, target named GLB pin node, connector normal, pin label, electrical role, `connectionSurfacePartId`, `connectionSurfaceKind`, and connection-surface tie point below is immutable.

Assembly contract:
[LOCKED_ASSEMBLY_CONTRACT]

Rules:
1. Do not add, remove, reverse, relabel, electrically reinterpret, or reconnect a wire.
2. Do not move, rotate, scale, replace, or hide any part. Mounted parts have already passed their seating checks.
3. Each listed endpoint is locked and belongs to a named physical pin node. Choose only bowDirection, a small lateral lane, and bowHeightMm. Do not return raw endpoint coordinates.
4. The coordinate system is metres and +Z is above the assembly surface. Produce compact, natural, flexible jumper leads: one shallow smooth bow between endpoints.
5. Target 4–7 mm bow height. Use a small lane offset to separate neighboring wires. Every route must be one open path. Never create a service loop, coil, circle, closed turn, overlap, knot, self-intersection, pipework, rigid 90-degree bend, high arch, decorative sweep, or floating bundled harness.
6. Keep active endpoints visually readable. Preserve the selected colors and exact signal labels.
7. Explicitly acknowledge the supplied mounted part IDs without changing their transforms.
8. USB-C is a forbidden wire endpoint unless the locked contract explicitly contains a USB cable. Never route a sensor wire to the controller body, a USB shell, a board centroid, or an inferred nearby coordinate.
9. The renderer will place one individual female Dupont sleeve over each selected male pin. Keep the first and last route segments aligned to the supplied connector normals so the wire exits the rear center of the sleeve before curving.
10. If any source/target node, connector normal, or pin gender is missing or contradictory, return `blocked: true` with the offending wire IDs. Do not repair the contract visually.
11. Treat `connectionSurfaceKind` literally. Never reinterpret an expansion carrier as a solderless breadboard, and never move a carrier endpoint onto the controller seated in that carrier.
12. Do not choose `top` or `underside`. The deterministic renderer derives the mating side from the locked male-pin and PCB mesh bounds by comparing exposed shank length beyond each PCB face. Preserve the supplied physical node IDs and return `blocked: true` if the contract lacks either node; never replace the classification with a visual guess.
13. Do not rotate a part to make its writing readable. Preserve every locked physical transform and let the deterministic renderer place only the locked title and pinout strings on the PCB top face with `+boardNormal`; this annotation cannot modify connectors, pins, sleeves, components, or wire routes.

Return only JSON in this shape:
{
  "wires": [
    {
      "wireId": "locked-wire-id",
      "bowDirection": "left | right",
      "lane": -8,
      "bowHeightMm": 5.5
    }
  ],
  "seatingReview": {
    "preserveVerifiedSeating": true,
    "mountedPartIds": ["locked-part-id"]
  }
}
```

Validate the response against this schema before rendering. Reject an omitted/unknown wire ID, a duplicate, a non-finite number, a lane outside the allowed range, or a bow outside 4–7 mm. Before constructing geometry, resolve every named GLB pin node under the declared part, verify connector bounds/gender/normal, and reject any point in the USB-C keepout. The deterministic renderer constructs the sleeves and cubic Bézier from those resolved nodes, then rejects any closed loop or self-intersection numerically; Sol does not author raw 3D coordinates.

## Sol 5.6 prompt: hero art direction

Sol writes an art-direction prompt, then `gpt-image-2` creates the image. Do not use the hero to derive electrical facts.

```text
You are the visual art director for a Makeable project hero image. Write one dense, accurate image-generation prompt for the exact locked kit below.

Locked kit and physical descriptions:
[SELECTED_PARTS_AND_REFERENCE_DETAILS]

Required wiring colors and named signals:
[LOCKED_WIRE_SUMMARY]

Rules:
1. Depict every selected component once, including external probes, cables, connectors, and the breadboard when present.
2. Use the exact board family, display form factor, sensor carrier shape, connector orientation, and selected header population described in the context. Do not substitute an Arduino, a generic development board, or a different sensor breakout.
3. Show realistic short flexible jumper wires in red (3V3), black (GND), blue (SDA), yellow (SCL), and green (analog) where applicable. Wires must be tidy and plausible, not plumbing or spaghetti.
4. Show a premium product-photography 3/4 composition with clean studio lighting, legible major components, and no text-heavy infographic layout.
5. Treat the image as illustrative only: do not invent labels, pins, or unlisted electronics.

Return the image prompt only, with no analysis.
```

Plant-companion-specific non-negotiable: the hero must visibly include the DIYables TLC555I soil-moisture sensor **blade** outside the enclosure plus its three-wire cable, the Waveshare ESP32-C6-LCD-1.47-M, the selected breadboard, BME280, BH1750, and all relevant colored jumpers. If the art model omits a locked component, retry or show the GLB-based assembly thumbnail instead.

## API/runtime configuration

Use server-side configuration only:

```text
OPENAI_BUILD_MODEL=gpt-5.6-terra
OPENAI_WIRING_MODEL=gpt-5.6-sol
OPENAI_HERO_ART_DIRECTOR_MODEL=gpt-5.6-sol
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_QUALITY=high
MAKEABLE_ASSEMBLY_REGISTRY_URL=https://<approved-cloudfront-origin>/<immutable-registry>.json
```

The API flow is:

1. Authenticate user and accept the request.
2. Run Terra on the approved catalog context.
3. Resolve selected parts against the AWS registry; fetch manifests/GLB metadata concurrently with code planning.
4. Verify manifest revision, CloudFront origin, SHA-256, declared bounds, anchors, and build recipe compatibility.
5. Create the immutable assembly contract with placements, electrical graph, instructions, and known endpoints.
6. Run Sol for bounded lane/bow presentation metadata; schema-validate it, then deterministically generate and numerically validate every route.
7. Return the assembly guide as soon as its contract is ready.
8. In parallel, have Sol produce hero art direction, render `gpt-image-2` at high quality, then attach/cached the hero when ready.
9. The browser fetches every GLB from CloudFront, hash-verifies it, then renders the guide. Never fetch from `public/assembly-assets`, a local file, or an unchecked URL.

## Acceptance checks for every production build

### Registry and asset checks

- Every selected catalog part maps to one exact approved asset revision.
- Every requested GLB returns HTTPS 200 with the approved CloudFront origin, expected content type, expected byte length, and SHA-256.
- Asset URLs are absolute HTTPS; root-relative, `http:`, `data:`, `file:`, credentialed, and unknown-host URLs fail closed.
- No GLB/GLTF/STEP/STP/STL is bundled in `apps/landing/public`, the static export, or release distribution.

### Assembly checks

- The required named source/target anchors exist and are unique.
- The electrical graph resolves every endpoint and never uses conflicting GPIO/power assignments.
- The global Z-up-to-Y-up conversion is applied equally to meshes, wires, anchors, magnifiers, and cameras.
- Breadboard-mounted components align by their approved pins/support datum rather than by eye.
- Every route starts and ends at geometry derived from its locked anchor/connector normal, consumes the locked cable length within tolerance, respects minimum bend radius, and clears every declared keepout.
- Every route endpoint resolves to a named pin/contact node beneath the declared `connectionSurfacePartId` and connector; the USB-C keepout contains zero non-USB endpoints.
- The rendered connection surface kind matches the contract. A carrier is not reported or routed as a solderless breadboard, and an absent breadboard has zero breadboard-row endpoints.
- Each direct male-pin endpoint visibly overlaps one individual female Dupont sleeve, and the wire centreline begins at the sleeve's rear centre along the connector normal.
- Every sensor endpoint records the measured top/underside shank exposure, selected mating side, pin tip, outward connector normal, and classifier version. BME280/BH1750-style downward headers must resolve underside; microphone-style upward headers must resolve top when their approved GLB geometry shows the longer exposed shank above the PCB.
- Every sensor title and pinout audit resolves to `surface: pcb-top`, `textNormal: [0,0,1]`, the canonical text-up vector, and `affectsPhysicalGeometry: false`; physical transforms and mating-side results remain byte-for-byte unchanged by the text pass.
- The selected step highlights its active endpoints and shows pin labels, not color alone.
- Failure to verify WebGL, hash, manifest, or an asset produces the deterministic 2D guide with the specific failure reason.

### Hero checks

- The prompt includes every selected part, external cable/probe, and enclosure constraint.
- The hero is clearly labeled illustrative, while the GLB assembly guide remains the authoritative physical reference.
- The hero may not block delivery of the usable assembly guide.

## Benchmark reference: plant companion, AWS-only assets

The successful real API benchmark used seven CloudFront GLBs (about **5.46 MB**) and generated no new parts or visual QA during the build request.

| Stage | Measured duration | Notes |
| --- | ---: | --- |
| Terra exact part selection | 6.42 s | Catalog-constrained planning |
| AWS registry/GLB branch | 0.56 s | Contract branch; observed fetch window 193.9 ms |
| Sol visual wire routing | 14.49 s | High-reasoning, schema-constrained routing |
| Assembly contract ready | about 21.3 s | Usable guide can be shown here |
| Sol hero art direction | 38.22 s | Runs in parallel with the asset branch |
| `gpt-image-2` high hero render | 158.41 s | Dominant latency |
| Full request including hero | 164.84 s | Hero completion, not assembly readiness |

Prompt experiments for wiring found the winner was the **bench-realistic bow**: natural 4–7 mm jumpers with small lateral lane separation. Compact 3–5 mm bows looked too taut; larger display bows were valid but theatrical. Keep this default unless a later controlled experiment replaces it.

### Production latency strategy

- Return build metadata and progress immediately.
- Return the interactive assembly guide as soon as the registry, contract, and Sol routing complete (target roughly 20–30 seconds for a cached-asset build).
- Render the hero asynchronously, cache by the locked kit/contract revision, and update the project when complete.
- Never hold the assembly guide behind a 2–3 minute image render.

## Offline catalog-maintenance workflow (not part of a user build)

1. Resolve exact catalog identity and buy variant.
2. Collect manufacturer datasheet, official reference images, schematic/pinout, mechanical drawing, ECAD/CAD/STEP where available, and connector/header evidence.
3. Generate or refine the GLB with accurate outline, holes, connectors, cable exits, header population, major components, and named wireable anchors.
4. Render front, underside, oblique, and pin-detail comparison views against official references.
5. Validate GLB structure, bounds, named nodes, hashes, visual review, and catalog crosswalk.
6. Publish immutable approved source files, manifest, review evidence, and registry pointer to AWS/CloudFront.
7. Only then mark the catalog part available for runtime selection.

This separation is deliberate: production builds are fast and deterministic because the slow visual research and model construction happened before the user asks for a project.

## Local simulation checklist

Use localhost only as the UI/API host. It must consume the same remote registry and CloudFront asset URLs as production.

1. Start the API with the server-side model configuration above.
2. Submit a project prompt and capture timestamped events from request start through part selection, registry lookup, contract creation, Sol routing, code generation, hero direction, hero render, and browser-ready guide.
3. Open the resulting assembly in the Codex browser.
4. Read the browser's machine state and the production trace; require every power/bus/signal wire to report its declared connection surface, sleeve/pin overlap, normal-aligned exit, cable-length result, and keepout result. Do not inspect pixels, score an image, or run a corrective visual pass.
5. Record remote GLB count/bytes, HTTP/CORS/hash results, model latency, and whether any fallback occurred.
6. Confirm the browser made no `/assembly-assets/*` local asset request and the deployment bundle contains no 3D binary.

## Current reminder

When results look wrong, do not solve it by asking an LLM to make arbitrary 3D geometry. First check: exact selected asset revision, anchor mapping, coordinate conversion, breadboard datum, immutable electrical graph, and route-schema validation. Use Sol to make the known-valid wiring easier to follow; use deterministic geometry to make it physically coherent.
