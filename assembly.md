# Makeable: AWS-only Assembly Generation Workflow

This is the reusable workflow for generating a Makeable project's cloud-backed circuit assembly and wiring guide. It contains only generic production rules learned from prior failures; it contains no canned project recipe.

Production scope lock: Makeable resolves immutable verified GLBs from AWS and generates only deterministic logical pin-to-pin guide geometry. The production workflow is always circuit-only. It has no hero-art, image, enclosure, housing, STL, firmware, or mesh-generation stage, and request input cannot enable one. It never calls Neural4D or another mesh generator and never converts a model to STL.

Failure hygiene: if a build is blocked at any stage, preserve the blocked plan and red-light evidence instead of rewriting it into a different project. Clear stale assembly state before the next run so a failed request never inherits the previous scene. No visual correction pass, human inspection pass, or prompt-only waiver may repair a bad wire.
If the review screenshot is clipped or too zoomed out to inspect the connection path, fix the render framing rather than relaxing the wire contract.

Connection-mode lock: every controller profile declares exactly one immutable mode: `carrier_required`, `xiao_base_required`, `integrated_direct_wire`, or `deferred_not_selectable`. Carrier and XIAO modes inject exactly the named compatible base and terminate every peripheral on that base. Integrated direct-wire controllers use only their proven external header contacts, never exceed two external peripherals unless the profile proves a larger capacity, and never receive an invented carrier. Deferred controllers are not selectable.

Presentation lock: the browser is a logical wiring guide. It renders verified electronic parts plus thin color-coded external component-pin to carrier-pin guide lines. It never renders Dupont sleeves, cable bodies, ribbons, plug housings, quick-connector cable meshes, JST cable meshes, adapters, or strain relief. Those connector contracts remain hidden electrical evidence and still gate compatibility.

Capability lock: extract the required capability set before parts planning, require 100% coverage, and fail closed if any requested capability has no exact implementation edge. A nearby part, a different carrier, or a visually similar connector is not a substitute.

Request identity lock: the API creates one canonical request fingerprint from the normalized user intent, required capabilities, explicit exclusions, selected BOM IDs, electrical graph, placement contract, and stage scope. Every stage and persisted record must carry the same fingerprint or fail with `blocked_request_identity_mismatch`. A missing build ID must never fall back to the first account, community, example, or previously generated project. Circuit-only scope is a fixed orchestration invariant, not a request flag or prose that a model may ignore.

Current red-light inventory: current omissions are tracked in `prompt2circuit/registry/current-red-light-inventory.md`, `prompt2circuit/registry/physical-asset-queue.md`, and `prompt2circuit/registry/assembly-red-light-worklist.md`. Those omissions are persistent blocks for future builds until the exact fix lands and the source registry is regenerated. Never resurrect a detained part, cable, connector, or edge by similarity, prose, or a fallback prompt.

Current production learnings to keep enforced on every future build:

- Quick connectors stay family-locked. Grove may terminate only on the exact Seeed XIAO Expansion Base through a named, straight-through, two-ended Grove cable; it never terminates directly on a bare microcontroller or a non-XIAO carrier. In circuit-only mode the cable is a required instruction/BOM item, while the scene draws exact ordered contact-to-contact guide lines and does not require or render a cable GLB. Qwiic stays on its exact keyed adapter/carrier path and never becomes a guessed jumper row.
- Carrier selection is mode-specific and family-specific. The ESP32-C3 Super Mini uses only its exact C3 carrier, the long 44-pin ESP32-S3 DevKit uses only its exact 44-pin S3 carrier, and every XIAO uses the exact XIAO Expansion Base. A carrier cannot be inferred from the controller body or from a similar-looking board.
- Carrier contact meaning comes from the exact hash-bound contact contract, not from plastic color, a legacy node-name fragment, or the generic name of a physical lane. On the approved full-size AITRIP 44-pin ESP32-S3 GVS carrier, ordinary GPIO rows remain yellow signal, red 3V3, and black GND. There is exactly one bounded mirrored-power exception: carrier asset `aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx`, carrier SHA-256 `aec8e5e6e81deb28f3a1da8ab56a76aba0429501964e7c86227cef0e4006a9da`, contact node `connector:left-breakout:5V:signal-inner:pin`. That yellow-bodied contact mirrors DevKitC J1 `5V` and is eligible only when the contact declares the complete `signal=5V`, `physicalLabel=5V`, `voltageDomain=5V`, capability `5V`, `electricalUsageRole=positive_power`, and `powerSourceClass=mirrored_controller_power_contact` contract and the selected peripheral's own active hash-bound `ownerDisposition` explicitly lists that class and carries a `mirroredPowerAuthorization` matching the peripheral ID/SHA, carrier ID/SHA, and exact contact node with `maximumConnections=1` and `physicalContactReuse=forbidden`. This permission is never inherited from voltage, product family, owner-verification status, another 5 V peripheral, or connector color. Missing or mismatched authorization makes this contact ineligible; use a distinct dedicated 5 V bank contact when that peripheral permits it, otherwise fail closed. Its logical guide is red because guide color follows the electrical net. Never extend the exception to another GPIO, rail mirror, carrier, hash, peripheral, or second connection.
- Normalize an integrated ESP32 development board as a controller even when a marketplace sheet mislabeled it as storage, output, display, or power. Before calling Sol, compare every exact product name, SKU, ASIN, and asset ID against the strict planner catalog and obey its connection mode. If the required carrier/base or direct-header contract is absent, return `exact_requested_part_not_one_shot` with the precise blocker; make no model call, select no substitute, and retain no prior assembly scene.
- Wires are route geometry only. They must exit on the verified connector normal, stay open and loop-free, clear every model solid, and never pass through a GLB body, connector housing, or sensor package.
- Text and pinout overlays always face up. If native silkscreen is mirrored, hidden, or underside-facing, the renderer may add only a top-face annotation; it must never rotate the part to “fix” readability.
- Circuit-only remains non-negotiable. No hero image, no enclosure, no housing, no STL, and no generated mesh stage may be introduced by prompt text.

Current red-light tracker:

- `l76k-gnss` remains partial because the active GLB still exposes a 3.00 mm pseudo-header instead of the official PH2.0 5-pin sale form, and the exact two-ended PH2.0 mating cable is still missing.
- `sparkfun-max30101-max32664-pulse-oximeter-sen-15219` remains partial because both Qwiic rows still measure 1.50 mm instead of 1.00 mm and the required RST/MFIO IC-hook pigtails are still missing.

## Production prompt routing

The runtime source of truth is the versioned prompt package at `prompts/production/manifest.json`. This document explains the larger system; it is never sent wholesale to a model.

| Stage | Owner | Runtime prompt | Purpose |
| --- | --- | --- | --- |
| `parts_plan` | `gpt-5.6-sol` (xhigh, priority) | `prompts/production/parts-planner.md` | Select or normalize one exact catalog-constrained build plan. |
| `asset_resolution` | Registry service | None | Verify immutable AWS assets, hashes, interfaces, and nodes in code. |
| `assembly_routing` | `gpt-5.6-sol` | `prompts/production/assembly-routing.md` | Return bounded lane, direction, and bow metadata for immutable wires. |
| `route_geometry` | Deterministic geometry | None | Build and validate connector-normal, no-loop geometry. |
| `browser_delivery` | Three.js renderer | None | Hash-verify and render accepted AWS GLBs and route geometry. |

Each Responses API call receives only its stage-specific developer instructions. Dynamic user/build data is supplied separately. JSON Schemas remain code-owned Structured Output configuration rather than prompt prose. Registry gates, geometry gates, compiler gates, mesh gates, and browser machine-state gates are deterministic validation—not model prompts and not visual passes.

## Product outcome

Given a user request such as “build me a smart plant monitor,” Makeable should return:

1. an exact, purchasable parts list;
2. a validated wiring/assembly contract using only approved AWS-hosted assets;
3. a browser assembly guide rendered from those GLBs;
4. beginner assembly instructions.

The live product must **not** generate meshes, inspect assets, or silently fall back to local GLBs during a user build. Asset research, GLB reconstruction, visual QA, registry publishing, and catalog reconciliation are offline catalog-maintenance work.

Catalog identity is fail-closed. Each purchasable ASIN/SKU resolves to exactly one active `selectionStatus=ready` GLB. Same-product aliases remain hash-visible for audit but are marked `retired_duplicate`, excluded from planning, and returned as structured errors when explicitly requested; the runtime never guesses between aliases or substitutes the survivor for a retired exact name.

## Non-negotiable runtime rules

- Resolve parts from the catalog by exact SKU, ASIN, AliExpress key, or manufacturer part number. Do not replace an exact part with a visually similar board.
- Fetch only the approved GLB, thumbnail, and interface evidence required by the circuit through immutable HTTPS URLs in the AWS/CloudFront registry. Do not request STEP/STL assets or generate new meshes.
- Reject a missing asset, incorrect SHA-256, unexpected CloudFront origin, missing required anchor, missing approved revision, or any asset whose `visualEligibility`, `interfaceEligibility`, or `selectionStatus` is not `ready`. Show the deterministic 2D fallback rather than a guessed 3D substitute.
- The wiring model may choose only presentation routing. It cannot move parts, invent endpoints, add wires, alter pin labels, or change electrical topology.
- Physical placements, named GLB pin nodes, wire inventory, electrical roles, and connection-surface tie points come from the immutable assembly contract. A renderer must never replace a missing pin node with a guessed coordinate near the controller.
- A controller USB-C receptacle is a forbidden wire endpoint unless the immutable contract explicitly selects a USB cable. Sensor power, ground, bus, and GPIO leads must land on the declared contact of the exact `connectionSurfacePartId`—not on the controller body, USB shell, or a visually convenient nearby point.
- Breadboards are prohibited. The contract must declare `connectionSurfaceKind` as exactly `expansion-carrier`, `breakout-board`, or `controller-header`; `solderless-breadboard`, breadboard rows, and breadboard rails are invalid production inputs.
- Keep `OPENAI_API_KEY` server-side. Never place it, a registry credential, or an AWS credential in client JavaScript, browser logs, telemetry, or prompts.
- An approved multi-part kit may carry immutable `nodeTransformRules` for catalog-owned subpart articulation. Apply those same transforms to named-node resolution, collision bounds, and browser rendering. This seats an included wheel on its exact servo spline without generating a replacement mesh. Leaving a required subpart detached, applying the transform only in the renderer, or moving it by model suggestion is a release failure.
- Extract the request's required capability set before parts planning and prove that every capability has an exact selected implementation edge before assembly. A semantically nearby part does not satisfy a missing capability; for example, temperature/humidity plus ambient light does not satisfy a requested CO2 measurement.
- Before persistence and again before browser delivery, verify the request fingerprint, normalized intent, selected BOM hash, electrical-graph hash, placement-contract hash, and stage-scope flags. A title, summary, BOM, or route belonging to a gallery seed or another request is cross-request contamination and must be blocked, never shown under the requested slug.

## Generic intact-servo compiler

Servo assembly is a code-owned electrical and geometry contract, never an instruction for Sol to improvise. Each selected servo profile declares `servoLoad` with channel count, accepted voltage range, conservative continuous-current budget, and startup/stall peak-current budget. Each logical servo channel consumes exactly one opposite-gender three-contact mate/harness asset, one distinct regulated POWER/GND output pair, and one distinct capability-approved PWM contact. A paired-servo kit expands into two channels even though it is one GLB part.

The regulated power/distribution profile must prove its upstream source and declare `outputVoltageV`, `continuousCurrentA`, `peakCurrentA`, one `commonGroundInputNodeName`, and a distinct output node pair for every allocated channel. The compiler sums all selected channel loads before choosing the smallest sufficient source, emits exactly one controller/carrier-to-power-system common-ground bond, and rejects missing voltage overlap, current headroom, channel capacity, or legal PWM. GPIO and the controller's 3.3 V sensor rail are never servo power.

Owner-bench-verified FS90R exception v3: for exact FS90R hashes carrying `ownerVerifiedCarrierPower.ruleId=owner-bench-fs90r-s3-carrier-gvs-v3`, and only with the exact full-size AITRIP 44-pin ESP32-S3 carrier plus an allowed full-size S3 controller, the owner's exact bench disposition authorizes up to four channels through the carrier's per-GPIO GVS rows. This is an owner-scoped exception; retain the manufacturer's nominal 4.8–6 V range as separate evidence and do not claim that the manufacturer validates the 3V3 route. A common electrical rail is not a reusable physical terminal. For every servo channel consume one complete, otherwise-unused carrier row: its black GND contact, its red 3V3 positive-supply contact, and its yellow PWM-capable signal contact. The three endpoints must share the same `breakoutBank` and `breakoutRowSignal`; four channels therefore consume four distinct rows and twelve distinct carrier contacts. If any complete matching trio is unavailable, fail closed before placement. Allocate left-side servos to left-side rows and right-side servos to mirrored right-side rows, then align each paired kit's GND-to-PWM contact frame with its selected carrier row so conductor order is preserved instead of crossed. Give every branch its own route identity even when rails are electrically common. Every pair of routes—including same-bundle and same-net routes—must pass endpoint uniqueness, loop, self-intersection, projected-crossing, solid-intersection, clearance, and bend gates. The browser must recompute these properties from route samples and may not trust zero-valued metadata. Render only three open logical guides per channel—black GND, red 3V3 positive supply, yellow PWM—and hide baked decorative FS90R `factory-lead` meshes. Never draw a loop, coil, closed-looking factory lead, shared-pin fan-in, cable body, splitter, or power-distribution accessory. Never generalize this exception beyond the exact assets, carrier, allowed controllers, owner disposition, and four-channel limit. The released plan must also remove any legacy prose that asks for a separate regulated servo supply, forbids this exact 3V3 route, calls the accepted logical mating path incomplete, or requests an accessory that the v3 compiler deliberately excludes.

The servo-side plug stays intact. For each channel the compiler emits six rigid contact mates and three `deformable-servo-harness` conductors: black GND, red regulated POWER, and yellow PWM. Deterministic placement fits the complete three-contact plug frame, independently fits the three source terminations, transforms both sets of wire-exit anchors, and routes the parallel free spans through the same no-loop, keepout, cable-length, and bend-radius gates as every other harness. If the exact mate or regulated power GLB is absent, the servo remains detained; a prompt cannot substitute three loose wires.

## Generic externally powered logic compiler

A peripheral whose immutable profile declares `poweredLogicLoad` is never compiled as an ordinary direct sensor. Its contract owns the exact device connector, accepted supply range, continuous and peak current, high-side signal voltage range, direction, controller-safe voltage range, required input capability, and maximum signal frequency. The compiler selects one unused `poweredLogicInterfaceSystem` whose upstream source, regulated output, 3.3 V logic supply, current headroom, common ground, translation thresholds, direction, and bandwidth all pass. A convenient 5 V controller label is not a substitute for that system.

One exact `poweredLogicHarness` preserves six physical roles: red DEVICE_POWER, black DEVICE_GROUND, yellow DEVICE_SIGNAL_HIGH, black SURFACE_GROUND, red SURFACE_LOGIC_SUPPLY, and yellow SURFACE_SIGNAL_LOW. The device-side three-contact plug is fitted as one keyed rigid group; every interface-system and controller-side termination is fitted independently. The high-side and low-side signal are separate nets on opposite sides of the translator. The compiler emits twelve rigid mates and six `deformable-powered-logic-harness` conductors, and routes them through the same exact-endpoint, no-loop, length, bend-radius, keepout, and collision gates as other harnesses.

Missing regulated power, current headroom, common ground, proven direction/thresholds, bandwidth, connector gender/order, wire exits, or a legal controller input detains the whole device. No prompt or renderer may connect a 5 V signal directly to an ESP32, split the keyed device plug, omit either ground path, or replace the interface with loose jumpers.

## Generic exact keyed-cable compiler

A part whose immutable profile declares `exactMatingCableRequirements` is never compiled as loose wires at its keyed socket or contact pad. Each requirement owns one endpoint connector, authoritative ordered contact list, routed signals, deliberately unmated signals, optional authoritative surface capability, and any configuration straps. The compiler selects one distinct unused cable asset per requirement only when its `exactMatingCable` contract has the opposite gender, identical contact order, complete active-conductor coverage, and both physical contacts for every deliberately unmated lead. One-contact hook/clip pigtails use this same contract rather than a special project recipe.

The keyed end is fitted as one rigid multi-contact group. Every far-end termination is fitted independently to one legal, unused controller or carrier contact. Each active conductor emits two rigid mates and one `deformable-exact-mating-cable` free span from immutable wire-exit anchors, with catalog length, diameter, minimum bend radius, keepout, collision, endpoint, and no-loop gates. A strap such as SEN55 SEL→GND remains a physical conductor whose device-side identity is SEL and whose far-end net/contact is GND. NC remains present in the cable's physical contract but receives no electrical route and no surface mate.

Missing cable GLB, connector/gender/order mismatch, missing far termination, routed NC, omitted strap, duplicate surface contact, insufficient length, or invalid geometry detains the whole edge. Sol may select only compatible catalog identities and may describe the accepted result, but it cannot infer, reorder, split, or repair this cable.

A multi-interface part may compose these edges with a bus cable. Every required signal is claimed exactly once before routing: for example, Qwiic owns GND/3V3/SDA/SCL while two separate hook pigtails own RST and MFIO. Claimed hook signals are removed from the bus request; bus signals are never duplicated in the hooks; each cable instance is consumed once; and all far ends reserve distinct legal controller/carrier contacts. The combined electrical graph must close before any geometry or presentation call.

## Generic selector-shunt compiler

A part whose immutable profile declares `selectorShuntRequirements` is never enabled by prose, a visually implied jumper, or a generated wire. Every requirement names one mode, one target connector, and exactly two ordered target signals. The compiler consumes one distinct unused physical part whose `selectorShunt` contract proves the opposite-gender two-contact socket, exact contact nodes, internal continuity, and engagement depth. It emits two `rigid-mate` contact pairs and one isolated internal-continuity net for each shunt.

The placement compiler fits the complete two-contact frame to the declared target pair, transforms the shunt body with the same rigid matrix, and applies the normal, pitch, clearance, collision, and no-short gates. One shunt cannot satisfy two requirements; a shunt cannot bridge an adjacent contact; and its closed net is not emitted as a routed conductor. Missing GLB, incorrect contact order, incompatible family/gender, failed rigid fit, reused part instance, or unintended continuity detains the configured peripheral before Sol is called.

## Generic operating-mode compiler

A multi-mode part is selectable only when its immutable `operatingModeContract` locks one active mode and bus, one exact required-signal set, one controller capability per physical signal, the accepted supply voltage, every controller-facing output-voltage range, the controller maximum input voltage, and a source-bound resolved factory configuration state. Composite silkscreen such as `TRIG/RX/SCL` or `ECHO/TX/SDA` is identity evidence for one physical contact, not permission to choose among modes.

The interface validator proves that every declared signal exists as one physical endpoint, the mode signal set exactly equals the electrical graph input, the supply is in the accepted range, every output maximum remains at or below the selected controller limit, and the compiler-visible capability map equals the contract. The electrical compiler then allocates only those signals and reports `operatingModesResolved=true`. An unresolved factory state, alternate-bus inference, missing capability, unsafe voltage, or extra inactive-mode wire detains the part before geometry and presentation.

For the circuit-only logical guide, individually addressable 2.54 mm header contacts may connect directly as compiler-owned pin-to-pin lines, including peripheral-to-peripheral paths such as analog sensor output to ADC input. No Dupont/JST/ribbon cable GLB, sleeve mesh, or cable BOM item is required or rendered for that edge. Exact endpoint identity, voltage, direction, capability, contact geometry, collision avoidance, and open-route gates remain mandatory. Keyed/grouped Grove, Qwiic, JST, servo, factory-harness, battery, and similar connectors retain their own strict topology rules.

## Runtime architecture

```text
User prompt + Google sign-in
             |
             v
Sol 5.6 xhigh: exact part selection and build plan
             |
             +---------------------+
             |                     |
             v                     v
AWS registry lookup       electrical/placement compilation
             |                     |
             v                     |
Immutable GLB manifests   |
             |                     |
             +-----------> immutable assembly contract
                                |
                                v
               Sol 5.6: bounded presentation metadata only
                                |
                                v
      browser fetches CloudFront GLBs, verifies SHA-256, renders assembly
```

The GLB registry request runs after parts are selected. Firmware planning is absent from this circuit-only production path. The only rendered output is the authoritative GLB circuit assembly guide.

## Model responsibility boundaries

| Stage | Owner | Allowed work | Forbidden work |
| --- | --- | --- | --- |
| Part picking | `gpt-5.6-sol` (xhigh, priority) | Select exact catalog parts, explain selection, identify an approved assembly recipe | Invent a part, choose an unapproved variant, alter asset metadata |
| Asset resolution | Registry service | Map selected catalog IDs to immutable CloudFront manifest/GLB revisions and hashes | Local-file fallback, fuzzy match, unsigned URL |
| Mechanical placement | Deterministic assembly contract | Apply approved mounted transforms and component-body clearances | LLM-generated poses or unverified collision claims |
| Wiring presentation | `gpt-5.6-sol` with xhigh reasoning on priority service | Acknowledge the immutable contract and return bounded presentation metadata only | Add/remove/reinterpret wires, endpoints, pins, voltages, or part placement |
| Browser | Three.js/R3F renderer | Download, SHA-check, render known assets and routes | Trust arbitrary URLs or model-authored geometry |

## Geometry and connection-surface seating invariants

The source contract and CAD assets use a right-handed **Z-up** coordinate convention. Three.js is **Y-up**. Convert the *entire scene* consistently:

```text
contract [x, y, z]  ->  Three.js [x, z, -y]
```

Apply that conversion to models, pin anchors, wire control points, callouts, and camera targets. Applying it to models alone causes floating modules and wires apparently routed through space.

For expansion carriers and GPIO breakout boards:

- The carrier or breakout is the authoritative wiring surface. The controller seated in its sockets is not a substitute wiring surface.
- The contract must lock `connectionSurfacePartId`, `connectionSurfaceKind`, and `controllerMountPartId`. For an ESP32-C3 Super Mini seated on its matching expansion carrier, all sensor leads originate on the carrier's named breakout pins; the controller USB-C is only a mechanical/service feature.
- On the approved full-size 44-pin ESP32-S3 GVS carrier, every ordinary GPIO row has exactly three physical roles: yellow is the printed SIGNAL net, red is the shared 3V3 rail, and black is GND. The red contact is never a duplicate GPIO. Allocate GPIO only from the yellow contact, 3.3 V power only from a distinct red contact, and ground only from a distinct black contact. Yellow contacts mirroring native controller 3V3/GND rows are reserved from production allocation. The exact yellow-bodied mirror on the row labelled `5V` is separately classified as 5 V positive power and receives a red guide; it is not a GPIO. Dedicated 5V/3V3/GND output blocks are separate valid contacts and may be selected only when the peripheral contract requests that exact voltage.
- On every expansion carrier, electrical continuity and physical termination are separate facts. Multiple red contacts may share one internal rail and multiple black contacts may share ground, but each external guide must consume one unused physical contact. Never collapse multiple loads onto one pin merely because their net labels match; reuse is legal only through an explicit physical splitter/crimp contract, never by drawing several lines into one carrier terminal.
- Terminal occupancy is a global deterministic gate, not a visual preference. Under `single-external-conductor-per-physical-contact-v1`, every physical pin, socket cavity, screw terminal, hook, and factory lead accepts one external conductor unless its exact immutable interface profile proves a higher capacity or the compiler supplies one explicit splitter/crimp authorization ID. Count both ends of every visible guide by exact `(partId,nodeName)`; same rail, same color, same signal, and same net do not permit reuse. A configuration pin gets its own carrier termination: BME280/BMP280 CSB goes to a separate unused 3V3 contact, BME280/BMP280 SDO goes to a separate unused GND contact, and MPU6050 AD0 or any SEL/mode/address strap gets its own compatible unused carrier contact. Never stack the strap on the sensor's VCC/GND pin. If the required extra carrier contact is unavailable, fail closed before placement and before Sol.
- On the approved ESP32-C3 Super Mini carrier, never assume the S3 lane order. The GPIO5-to-GPIO21 bank is `SIGNAL/VCC2/GND` from the outside edge toward the controller; the GPIO4-to-GPIO0 bank is `GND/VCC1/SIGNAL` from the controller toward the outside edge; VCC1 and VCC2 are factory 3.3 V rails. The separate 3x3 block contains three duplicate taps for each of 5V, GND, and 3V3. All visible guides terminate on these carrier breakout contacts, never the seated controller sockets or USB-C.
- Every endpoint record must include `partId`, `connectorId`, `nodeName`, `physicalPinLabel`, connector gender/family, and the node normal. The named GLB pin node must be a descendant of the declared source part and connector.
- Resolve the named node only after the final approved part transform is applied. Use the resolved world transform for the pin tip and normal; never use a guessed world coordinate, board centroid, or camera-relative offset.
- Reject an endpoint if its node is absent, duplicated, outside the declared connector bounds, inside the controller/USB-C keepout, or on a connector whose gender cannot mate with the selected lead.
- A GLB may contain a render mesh, board-plane anchor, semantic/label marker, and contact-tip frame for the same physical pin. Only the hash-bound profile's sole outward termination frame is routable. Metadata layers never create extra contacts, and a top-side marker may never replace an evidence-bound underside or side-entry male-pin tip.
- A visible guide line must begin at the exact accepted external component contact and end at the exact accepted carrier contact. No endpoint sleeve, plug, crimp, or cable accessory is drawn. The first and last segments still follow the supplied contact normals before the line begins its smooth bow.
- An ordinary one-contact 2.54 mm male-pin-to-male-pin connection is a compiler-owned `routed-conductor`, not a catalog cable. The renderer draws one pin-to-pin guide line and the planner must not require a separate jumper GLB or BOM line. This applies only to individually addressable, geometry-audited 2.54 mm pin tips on the peripheral and compulsory carrier, with distinct carrier contacts and compatible electrical capabilities. It never converts Grove, Qwiic/JST-SH, JST-PH/GH/XH, servo, multi-contact keyed, factory-harness, battery, or hook-clip interfaces into loose jumpers.
- Sensor-side endpoints must resolve both the physical male-pin mesh and the physical PCB/core mesh, not a pad-centre anchor or an inferred point. After the final part transform, measure the pin's exposed shank beyond both PCB faces along the board-normal axis: `topExposure = max(0, pinMax - pcbTop)` and `undersideExposure = max(0, pcbBottom - pinMin)`.
- Deterministically select the side with the longer usable exposed shank. A top-side header uses the top pin tip and outward `+boardNormal`; an underside header uses the bottom pin tip and outward `-boardNormal`. Place the female sleeve on that selected side and make the wire exit farther away from the PCB before it bends.
- Fail closed if the winning exposure is below 1.5 mm, the top/bottom difference is below 1.0 mm, the normalized confidence is below 0.25, either physical mesh is missing, or the transformed bounds are invalid. Sol never selects, overrides, or visually guesses the mating side.
- Never route a lead into the decorative pad, silkscreen label, solder joint, plastic header body, or either PCB face. Approved catalog QA must confirm that male-pin and PCB meshes represent the purchased header orientation; runtime classification can only be as correct as the immutable GLB geometry.
- Treat readable silkscreen as an annotation layer, independent from the physical board and connector orientation. Every sensor title, signal name, voltage label, and pinout label must lie on the PCB top face with text normal `+boardNormal` and a canonical text-up vector aligned to the assembly front.
- Never flip, mirror, rotate, or relocate the PCB, male pins, sleeves, components, or wiring endpoints to correct text. If approved native text is missing, mirrored, underneath, or oriented away from the top, the deterministic renderer may add only a top-face title/pinout annotation; it must not change physical geometry or electrical connectivity.
- Text/pinout overlays must be generated from locked catalog labels and pin names, not Sol prose. They must record `partId`, layer type, exact text, top-face normal, text-up vector, and `affectsPhysicalGeometry: false`. Native microphone text may be preserved when catalog QA already verifies it as top-facing.
- For replicated carrier rails, allocate a distinct physical carrier contact to every sensor lead. For `integrated_direct_wire`, allocate a distinct proven external controller-header contact to every lead. Shared-crimp exceptions are forbidden. A shared electrical rail is valid only when the selected surface exposes distinct physical contacts whose continuity and voltage domain are proven.

Controller-family compatibility is exact and non-inheritable:

- A controller or carrier cannot become generically ready from the handful of contacts used by a previous sample build. Its profile must cover the complete exposed connector geometry using immutable GLB node frames or an ordered manufacturer pinout whose asset ID and SHA-256 exactly match the active GLB. Project labels such as `presence`, `status`, `plant`, or `robot` never define reusable pin capabilities.
- A connector-body landmark, row-center landmark, PCB pad, header body, silkscreen marker, USB shell, or whole-row centroid is never a physical wire endpoint. A multi-pin interface becomes routeable only when every signal resolves to its own hash-bound contact mesh, or to a complete source-bound connector-face primitive with exact pin count, pitch, axis, outward normal, ordered signals, contact inset, and measured bounds. Never distribute guessed virtual pins along one coarse landmark.
- Preserve source-bound numbered-header order through every placement transform. Camera angle, text orientation, board rotation, and visually similar marketplace variants cannot reverse GND/VCC/SCL/SDA or any other row. Wires terminate on the exact contact nodes, never on header plastic, pads, internal display contacts, connector housings, or USB geometry.
- Keep every physically exposed contact in the interface profile, including boot, USB, reset, onboard-peripheral, PSRAM, and other reserved pins. Reserved pins carry zero generic allocation capabilities, so the electrical compiler cannot select them even though the renderer can show and label them.
- Normalize every carrier socket to its canonical underlying controller pin before allocation. Duplicate inner/outer, A/B, or mirrored socket nodes remain distinct physical termination points but never count as extra GPIOs; one canonical GPIO can satisfy at most one logical signal.
- When a keyed connector's contacts are combined into one opaque GLB mesh, derive distinct cavity frames only from exact-hash evidence containing ordered signals, physical pitch, pin axis, outward normal, and source-mesh bounds. A centroid duplicated four times, appearance-based order, or unbound connector face is invalid.
- Allocate every keyed-to-socket adapter as one compact contact cluster. GND, accepted power, SDA, and SCL must use distinct physical nodes; SDA/SCL must use distinct canonical GPIOs; the complete cluster must remain within the compiler's accepted span.
- Allocate every ordinary loose-wire peripheral as one compact carrier-side cluster too. Do not choose GND, power, and signals independently across opposite carrier banks. Prefer one legal bank and its centre-facing signal lane, keep the cluster inside the configured span, and place that peripheral outside the same bank so its conductors never cross the controller body to reach their pins.
- Default conductor colors are electrical semantics, not visual inference: GND is black; positive-power aliases 3V3, 5V, VCC, VBUS, VSYS, VIN, and POWER are red; signal and I/O are yellow. Factory harness colors remain immutable and are never used to infer polarity.

- `carrier_required` and `xiao_base_required` builds require their exact expansion surface first. No XIAO, C3 Super Mini, or long S3 board may bypass its matching carrier/base. `integrated_direct_wire` controllers are the only direct-header exception and may use only profile-proven external contacts within the profile's peripheral limit. Grove modules may connect only through the exact Seeed XIAO Expansion Board/Base. Grove is forbidden on every other carrier, breakout, bare microcontroller, and integrated direct-wire controller.
- Every ESP32-C3 Super Mini build must use the exact approved C3 Super Mini carrier, even with one peripheral. Its carrier endpoints, polarity, sockets, and GPIO rails must come from that carrier's own ready interface profile. It has no implied Qwiic, Grove, or other quick-connector capability; if its active hash, 16-contact mount, lane netlist, or factory-3.3V VCC1/VCC2 contract changes, the entire controller family fails closed.
- Every long 44-pin ESP32-S3 DevKit build must use the exact approved 44-pin S3 carrier, even with one peripheral. It cannot use a C3 Super Mini or XIAO carrier, and it inherits no connector capability from either family.
- The C3 carrier is production-selectable only when the active hash owns an immutable 16-contact mount contract, all 16 controller/socket contact frames fit within the declared tolerance with opposing normals, its asymmetric two-bank lane netlist is present, and VCC1/VCC2 remain factory 3.3 V with no rail modification. Missing or changed fields fail closed.
- The 44-pin S3 carrier is production-selectable only with the immutable mount contract `2x22 + usb_c_aligned_with_carrier_arrow`, the complete ordinary-row yellow-SIGNAL/red-3V3/black-GND GVS netlist, the bounded mirrored-controller-5V classification, and source-bound dedicated 3V3/5V/GND power blocks. USB-C is the default controller power source; a 5 V carrier contact may be used only for an exact owner-bench-approved 5 V peripheral route and must be either a dedicated bank contact or the explicitly classified mirrored controller 5 V contact. The DC barrel input is not a generic production power source. Missing or changed fields fail closed.
- The XIAO expansion base is production-selectable only when the active hash owns an immutable 14-contact mount contract and all 14 XIAO/socket frames fit within tolerance with opposing normals. The corrected 15.24 mm-row base becomes selectable only after its canonical AWS hash is active and those gates pass against the live bytes.
- No controller/carrier transform may be accepted from board bounds, appearance, a product-family name, or a prompt. Solve it from the complete declared physical contact-frame set and fail closed on count, pitch, residual, normal, polarity, or family mismatch.
- A carrier with `candidate_review` or `interfaceEligibility != ready` is blocked from production selection even when a visually similar GLB exists.

## Wiring appearance standard

The previous bad output used tall, angular, plumbing-like lines. The production visual standard is a compact flexible jumper.

- Each connection is one open smooth cubic Bézier bow from its verified named GLB pin node to its verified target pin node.
- Preserve exact endpoints. Only the intermediate bow can change.
- Default bow height: **4–7 mm above the assembly plane**.
- Give adjacent wires small, deterministic lateral lane offsets so red/black/blue/yellow/green wires do not collapse into a single line.
- Use about 12 sampled points per cubic curve; use a thin round tube/line with a small active-step highlight.
- Completed wires remain visible but subdued. The active wire and both endpoints remain clear.
- Cable loops are categorically forbidden, including service loops and coils used to consume excess cable length. Never generate a circle, closed turn, repeated traversal, overlap, knot, or self-intersection. The route may be straight, gently bent, or asymmetrically bowed, but it must remain one open path.
- Avoid squared corners, 90-degree conduits, extreme arches, random crossing, opaque bundles, or tubes thicker than the pins.
- Every logical guide uses one continuous smooth arch family: two sampled cubic Bézier spans joined at one apex with a continuous tangent, plus exact connector-normal exit and entry tangents. An underside-facing pin must first clear the PCB below its physical edge, then join the main arch through a tangent circular transition whose measured radius is at least the guide contract minimum; a tight below-board U-turn or a curve that re-enters the PCB keepout is forbidden. A vertical riser joined to a flat roof, rectangular plumbing, stepped conduit, or long constant-height plateau is forbidden.
- Wire color is helpful but never the sole cue: label every connection with its exact signal and pin name.
- Accept a route only after deterministic geometry proves pin/sleeve overlap, centreline exit along the connector normal, required bend radius, cable-length feasibility, zero closed loops, zero self-intersections, and zero keepout intersections. Treat every fetched GLB's padded world-space bounds as a hard solid: after the short contract-owned connector engagement, every sampled free-span point plus the full cable radius must remain outside every GLB bound. The route must rise above the tallest intervening padded bound before crossing its XY footprint. Do not use a visual correction pass to enforce this rule. An endpoint magnifier may display an already accepted result, but it is never a production decision gate and never triggers a correction pass.
- Around a crowded carrier, place each peripheral on the nearest clear left, right, top, or bottom side instead of extending a one-dimensional chain. Rotate a side-entry keyed sensor only by the deterministic transform that faces its selected connector toward the carrier, then resolve every node and keepout through that same transform. Route short local harnesses before longer ones, give every bundle a deterministic lane and small bow-family offset, and reject cross-bundle contact, crossing, twisting, or collapse.
- Never assign one progressively taller global height layer per wire. Start all device bundles in the same shallow clearance band, preserve stable within-device conductor order, and add only the minimum local lift that the collision solver proves necessary. A staircase, cage, or tall rectangular fan-out is a failed route even when its endpoints are electrically correct.
- Prefer an open readable placement with 20–35 mm of clear air between neighboring component bodies when the exact harness permits it. The placement solver may increase spacing only while the complete accepted route remains within the physical cable length after subtracting connector engagement, strain relief, bend-radius allowance, and service-slack reserve. A visually clean but taut or overlength cable is blocked.

## Sol 5.6 xhigh prompt: exact part selection

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
3. Satisfy voltage, GPIO, I2C/SPI/UART, ADC, power, connector, and carrier constraints using the supplied facts only. Breadboards are prohibited.
4. Return a concise bill of materials, a reason for each selection, and an assembly recipe ID. Identify uncertainty explicitly instead of guessing.
5. Do not create wiring positions, wire routes, GLB URLs, image prompts, or any non-circuit output. Deterministic circuit stages run only after exact parts are locked.

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
11. Treat `connectionSurfaceKind` literally. Reject `solderless-breadboard`; never move a carrier endpoint onto the controller seated in that carrier.
12. Do not choose `top` or `underside`. The deterministic renderer derives the mating side from the locked male-pin and PCB mesh bounds by comparing exposed shank length beyond each PCB face. Preserve the supplied physical node IDs and return `blocked: true` if the contract lacks either node; never replace the classification with a visual guess.
13. Do not rotate a part to make its writing readable. Preserve every locked physical transform and let the deterministic renderer place only the locked title and pinout strings on the PCB top face with `+boardNormal`; this annotation cannot modify connectors, pins, sleeves, components, or wire routes.
14. Preserve every compiler-supplied passive `subcomponentId`, terminal ID, value/tolerance, required tie ID, target net, and splice mode. A stranded lead remains one terminal even when its GLB contains multiple copper-strand meshes. Never omit a pull-up branch, leave a passive one-ended, or treat a loose resistor mesh as already connected.

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

## API/runtime configuration

Use server-side configuration only:

```text
OPENAI_BUILD_MODEL=gpt-5.6-sol
OPENAI_WIRING_MODEL=gpt-5.6-sol
MAKEABLE_ASSEMBLY_REGISTRY_URL=https://<approved-cloudfront-origin>/<immutable-registry>.json
```

The API flow is:

1. Authenticate user and accept the request.
2. Run Sol xhigh on the approved catalog context.
3. Resolve selected parts against the AWS registry; fetch manifests/GLB metadata concurrently with code planning.
4. Verify manifest revision, CloudFront origin, SHA-256, declared bounds, anchors, and build recipe compatibility.
5. Create the immutable assembly contract with placements, electrical graph, instructions, and known endpoints.
6. Run Sol for bounded lane/bow presentation metadata; schema-validate it, then deterministically generate and numerically validate every route.
7. Return the assembly guide as soon as its contract is ready.
8. The browser fetches every GLB from CloudFront, hash-verifies it, then renders the guide. Never fetch from `public/assembly-assets`, a local file, or an unchecked URL.

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
- The rendered connection surface kind matches the contract. A carrier is never reported as another surface type, and any breadboard surface or endpoint blocks delivery.
- Each direct male-pin endpoint visibly overlaps one individual female Dupont sleeve, and the wire centreline begins at the sleeve's rear centre along the connector normal.
- Every sensor endpoint records the measured top/underside shank exposure, selected mating side, pin tip, outward connector normal, and classifier version. BME280/BH1750-style downward headers must resolve underside; microphone-style upward headers must resolve top when their approved GLB geometry shows the longer exposed shank above the PCB.
- Every sensor title and pinout audit resolves to `surface: pcb-top`, `textNormal: [0,0,1]`, the canonical text-up vector, and `affectsPhysicalGeometry: false`; physical transforms and mating-side results remain byte-for-byte unchanged by the text pass.
- The selected step highlights its active endpoints and shows pin labels, not color alone.
- Failure to verify WebGL, hash, manifest, or an asset produces the deterministic 2D guide with the specific failure reason.

## Benchmark reference: plant companion, AWS-only assets

The successful real API benchmark used seven CloudFront GLBs (about **5.46 MB**) and generated no new parts or visual QA during the build request.

| Stage | Measured duration | Notes |
| --- | ---: | --- |
| Sol xhigh exact part selection | 6.42 s | Catalog-constrained planning |
| AWS registry/GLB branch | 0.56 s | Contract branch; observed fetch window 193.9 ms |
| Sol visual wire routing | 14.49 s | High-reasoning, schema-constrained routing |
| Assembly contract ready | about 21.3 s | Usable guide can be shown here |

Prompt experiments for wiring found the winner was the **bench-realistic bow**: natural 4–7 mm jumpers with small lateral lane separation. Compact 3–5 mm bows looked too taut; larger display bows were valid but theatrical. Keep this default unless a later controlled experiment replaces it.

### Production latency strategy

- Return build metadata and progress immediately.
- Return the interactive assembly guide as soon as the registry, contract, and Sol routing complete (target roughly 20–30 seconds for a cached-asset build).
- Do not schedule or wait for image, enclosure, housing, STL, or mesh-generation work.

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
2. Submit a project prompt and capture timestamped events from request start through part selection, registry lookup, contract creation, Sol routing, code generation, and browser-ready guide.
3. Open the resulting assembly in the Codex browser.
4. Read the browser's machine state and the production trace; require every power/bus/signal wire to report its declared connection surface, sleeve/pin overlap, normal-aligned exit, cable-length result, and keepout result. Do not inspect pixels, score an image, or run a corrective visual pass.
5. Record remote GLB count/bytes, HTTP/CORS/hash results, model latency, and whether any fallback occurred.
6. Confirm the browser made no `/assembly-assets/*` local asset request and the deployment bundle contains no 3D binary.

## Current reminder

When results look wrong, do not solve it by asking an LLM to make arbitrary 3D geometry. First check: exact selected asset revision, anchor mapping, coordinate conversion, connection-surface transform, immutable electrical graph, and route-schema validation. Use Sol only for bounded presentation metadata; deterministic geometry owns physical coherence.
# Production connection compiler addendum — 2026-08-31

This addendum is normative for every new build. It replaces prompt-only visual assumptions with machine-enforced connection classes and release gates.

## Connection classes

| Class | Registry evidence required | Geometry owned by | Rendered representation | Release failure |
|---|---|---|---|---|
| `board-mount` | Exact module and socket contact nodes, family, polarity, orientation, all mating contacts | Deterministic placement solver | Rigid seated module; no wire | `board_mount_unresolved` |
| `rigid-mate` | Plug and receptacle contact frames, family, gender, key, pin order, mating side, engagement normal/depth | Deterministic mating solver | Exact seated plug/sleeve; contacts stay in netlist | `connector_incompatible` |
| `factory-harness` | Device exit frames, integral conductors, exact colors/order/diameter/length/bend radius, movable plug ownership | Deterministic flexible-harness solver | Physical round conductors from device exits to the rigidly seated factory plug | `missing_flexible_factory_harness_contract` |
| `included-factory-harness` | Both termination contact sets, conductor source-node groups, connector housings, engagement transforms, exits, usable length/diameter/bend radius, and retain/hide/rerender policy | Deterministic included-harness solver | Exactly one seated two-ended harness, never a baked cable plus duplicate jumpers | `required_included_factory_harness_contract_missing` |
| `routed-conductor` | Two routable contact nodes and compatible individual wire housings | Deterministic jumper router | One round insulated tube plus required endpoint sleeves | `non_routable_contact` |

Mating-only or `nonRoutable` contacts never become generated wires. An intact multi-pin plug is one rigid mate, not several loose conductors. The electrical graph may contain each contact net while the assembly graph contains one plug mate and one integral factory harness.

A battery or external-power connector is non-routable until exact polarity is source-bound to the active asset hash and physical contact nodes. Connector family, pin numbering, marketplace convention, proximity, and rendered wire color are not polarity evidence. GLBs that already contain a cable remain detained until both ends and every conductor are compiled as one physical harness; the renderer must never overdraw them with a second set of free jumpers.

## Universal readiness reducer

Every build begins as `candidate`. It becomes `ready` only through `candidate -> gates_passed -> ready`. Any missing or contradictory evidence yields `blocked` and stable machine-readable reasons. The renderer must display the returned state; it cannot manufacture a Ready badge.

The mandatory gates are:

1. exact active catalog identity;
2. approved CloudFront origin and SHA-256;
3. visual, interface, and selection eligibility all equal `ready`;
4. every required GLB node resolves exactly once;
5. every endpoint world frame derives from its node and the complete final part transform;
6. connector family, gender, key, order, side, normal, and engagement compatibility;
7. voltage, current, signal direction, GPIO capability, reserved pin, boot/strap pin, and bus legality;
8. board mounts and rigid mates satisfy transform and engagement depth;
9. routed conductors satisfy endpoint, length, physical radius, bend radius, zero-loop, self-intersection, wire-to-wire, and mesh-clearance checks;
10. controller pin capabilities and peripheral modes equal the accepted electrical graph;
11. every assembly step references only accepted parts, mates, and wires.

Sol is called only after deterministic gates 1–8 pass. Sol chooses bounded bow side, compact height, and lane presentation; it never selects pins, creates endpoints, certifies seating, or certifies collision. No production customer build uses a visual correction pass.

## Global circuit-only rule

The production assembly result contains only the accepted circuit. Hero images, image prompts, STL files, enclosure or housing meshes, generated brackets, Neural4D, and every other mesh-generation or mesh-repair service are structurally absent. No request field or model response may add those stages or outputs.

## Multi-controller resource compiler and ESP-NOW contract — 2026-09-01

This section is normative for all prompt-to-circuit builds. It replaces the former assumption that one ESP32 must physically terminate the entire BOM.

### Node allocation

1. The planner selects one logical coordinator and every requested functional peripheral. It may repeat a non-controller catalog ID to represent quantity. It must never drop a requested peripheral because one controller appears to lack GPIO or contacts.
2. The deterministic compiler—not Sol—owns node count, controller type, carrier injection, pin allocation, bus allocation, and network topology.
3. For each peripheral in stable BOM order, the compiler tries existing compatible nodes. A candidate placement is accepted only when the complete existing electrical compiler succeeds with the additional peripheral.
4. Legal I2C or other explicitly shareable controller buses are exhausted before adding a node. Bus sharing never means physical carrier-pin sharing: every carrier-side power, ground, and signal guide still terminates on a distinct named contact. Controller-pin aliases may share only when the interface profile marks that canonical bus as shareable.
5. If the next peripheral cannot compile on an existing node, create a new node from an exact ready controller plus its exact compatible carrier, reset that node's local resource map, and compile the peripheral from scratch. If it fails alone, return `espnow_peripheral_unassignable`; do not keep adding boards to conceal an incompatible part.
6. Grove is exclusive to a Seeed XIAO ESP32 seated in the exact Seeed XIAO Expansion Base. Non-Grove peripherals never use that node. Grove never terminates on a bare XIAO, C3 Super Mini carrier, full-size S3 carrier, integrated display controller, or another microcontroller.
7. Ordinary non-Grove overflow uses an exact ready full-size ESP32-S3 DevKitC controller with its exact AITRIP 44-pin carrier when that pair exists. A custom/test registry may clone another already compatible carrier-backed controller only when the exact preferred S3 pair is absent.
8. When an integrated ESP32 display/camera controller cannot host the complete external BOM, keep it as the coordinator/display node and place all external peripherals on carrier-backed sensor nodes. Never draw an inter-controller power, ground, UART, or GPIO wire as a substitute for ESP-NOW.
9. Use the fewest nodes that satisfy all exact contacts, canonical GPIO capabilities, voltage domains, power budgets, operating modes, connector families, and support-asset requirements. Count is only a coarse cap; successful compilation is the capacity proof.
10. The default encrypted topology is capped at eight controllers total: one coordinator plus seven peers. A ninth node fails closed with `espnow_default_encrypted_node_limit_exceeded`.

### Per-node physical rules

- Every node owns its controller, its own compulsory carrier when required, and only its assigned peripherals.
- Each carrier-mounted controller must pass the exact mount and polarity contract.
- Local wires remain logical pin-to-pin guides: black ground, red positive power, stable non-red/non-black signal colors, one exact named endpoint at each end, one clean open natural arch, no loops, no rectangular piping, no crossing, no mesh intersection, and no reused physical carrier contact.
- A wireless link is never included in `assembly.wires`, never counted as a conductor, never given a pin endpoint, and never used to satisfy a local electrical net.
- Arrange complete node clusters on a deterministic two- or three-column grid with clear air between their world bounds. Translate every part, keepout, endpoint, and accepted local route by the same node offset; never move only the visual mesh.
- The renderer may display each coordinator-to-peer relationship as a thin dashed cyan radio arc labeled `ESP-NOW`. This is explanatory network notation, not cable geometry, and it is excluded from physical route/collision/no-loop counts.

### Firmware transport contract

The circuit stage still generates no firmware source. For a multi-node build it must emit `MakeableEspNowFirmwareContractV1` with:

- one encrypted-unicast star coordinator and explicit peer nodes;
- Wi-Fi started before ESP-NOW initialization;
- one explicitly configured shared channel and station-interface policy;
- peer registration before send;
- deployment-time PMK and per-peer LMK provisioning, with no MAC address, key, credential, or secret embedded in the artifact;
- multicast encryption forbidden;
- a versioned message envelope with `protocolVersion`, `nodeId`, `sequence`, `messageType`, `timestampMs`, and `payload`;
- a 250-byte compatibility payload maximum;
- telemetry, command, acknowledgement, heartbeat, and fault message types;
- application acknowledgements, a 250 ms acknowledgement timeout, three bounded retries with 50/125/250 ms backoff, required sequence numbers, and duplicate-sequence suppression;
- an explicit statement that the MAC-layer send callback is not application-delivery proof;
- Wi-Fi callbacks restricted to queueing work, with application processing outside the high-priority Wi-Fi callback.

A single-node build preserves `not-generated-by-circuit-compiler` and has no transport contract. A multi-node build uses `transport-contract-ready-source-generation-disabled`: the network is specified for the later firmware stage, but this circuit-only flow does not silently generate or flash code.

### Network readiness gates

A multi-controller assembly is ready only when:

1. every local node graph is ready;
2. every local node placement and wire route passes the full single-node gates;
3. every peripheral belongs to exactly one node;
4. every node contains exactly one controller and, when required, exactly one compatible carrier;
5. every non-coordinator node has one encrypted-unicast ESP-NOW link to the coordinator;
6. wireless link count equals controller node count minus one;
7. wireless links are absent from physical nets and `assembly.wires`;
8. the default encrypted-peer limit is not exceeded;
9. the transport contract contains no secret material; and
10. the presentation explains provisioning without inventing radio identities or physical controller-to-controller wiring.
