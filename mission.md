# Mission — believable AWS-only, breadboard-free assembly generation

## Goal

Generate a production-style electronics build using only approved GLBs streamed from the AWS/CloudFront registry. The 3D assembly must read as a physical build: every electrical path terminates directly on a verified part pin or keyed connector contact. Breadboards, hidden power rails, invented junctions, and decorative wires are prohibited.

## Model responsibilities

| Stage | Model / system | Allowed work | Must not do |
| --- | --- | --- | --- |
| Part selection | `gpt-5.6-terra` | Choose compatible catalog roles and explain the build intent. | Substitute the locked benchmark kit with a generic lookalike. |
| Placement | Deterministic validator | Place every approved GLB using its verified local coordinate frame. | Let an LLM invent transforms or claim collision/continuity proof. |
| Wiring presentation | `gpt-5.6-sol` (high reasoning) | Choose restrained lateral lanes and natural bow direction for each immutable connection. | Change pins, voltage, wire inventory, electrical meaning, part transforms, or introduce a breadboard. |
| Hero art direction | `gpt-5.6-sol` (high reasoning) | Write a concise exact-kit visual brief. | Omit the soil probe, invent alternate boards, or introduce a breadboard. |
| Hero pixels | `gpt-image-2` (high quality) | Render the Sol-approved brief. | Act as the wiring or electrical authority. |
| GLB delivery | AWS CloudFront registry | Stream approved, hash-checked GLBs into memory. | Use a local GLB, generate a new model, or bypass SHA verification. |

## Locked direct-wired plant benchmark

The benchmark contains six AWS GLBs:

1. SparkFun Thing Plus ESP32 WROOM.
2. Adafruit SCD-41 CO2, temperature, and humidity breakout.
3. Adafruit TSL2591 ambient-light breakout.
4. DIYables TLC555I capacitive soil-moisture sensor.
5. Plant-companion enclosure base.
6. Plant-companion enclosure lid.

The two Adafruit boards form a direct keyed Qwiic/STEMMA QT chain from the Thing Plus: GND, 3V3, SDA/GPIO21, and SCL/GPIO22. The soil sensor's three factory leads terminate directly on Thing Plus GND, 3V3, and A0/GPIO26. This gives 11 immutable conductors and no intermediate prototyping board.

## Physical invariants

1. `no-breadboards-v1` applies to catalog selection, assembly generation, validation, rendering, and release.
2. Every wire endpoint kind is either `verified-part-pin` or `verified-keyed-connector-contact`.
3. A Qwiic/STEMMA QT connection uses the verified four-contact keyed connector; the renderer may expose its four colored conductors for legibility, but may not change their electrical endpoints.
4. Sol plans presentation only. The assembly contract remains the authority for endpoints and electrical rules.
5. A visible conductor uses a thin, smooth, shallow bow. It must not resemble plumbing, form unexplained loops, or cross through a part body.
6. The external soil blade and strain-relieved factory cable must remain visible.
7. AWS assets are accepted only after HTTP success, GLB content-type/signature checks, and SHA-256 verification in memory.

## Breakout-board evidence gate

`esp32-sensor-count-v1` governs controller-to-sensor topology:

- One or two sensors may connect directly to verified ESP32 power, ground, GPIO, or keyed contacts. A second sensor may use a second ground pin; a shared ground or power pin is allowed only when the actual multi-wire termination is modeled and verified.
- Three or more sensors require the exact controller-footprint expansion board. The planner must match the locked footprint family and a hash-bound GLB; it may not substitute by ESP32 chip name or pin count alone.
- Marketplace listings remain research candidates until exact sold variant, mechanical footprint, connector population, pin mapping, deterministic GLB, validator results, and hash-bound review are complete. Unmatched footprints remain blocked rather than receiving a fabricated generic carrier.

## Final AWS-only local run (2026-08-28T09:50:52.859Z)

Build `build-a-plant-companion-that-measures-soil-49ab15b1` completed through the production-style local pipeline:

- `gpt-5.6-terra` planning: 15.56 s.
- AWS assembly branch: 10.69 s.
- Six CloudFront GLBs: 5,886,396 bytes, fetched in a 221 ms window and hash-verified in memory.
- `gpt-5.6-sol` wiring: all 11 immutable conductors accepted with direct-pin/keyed-connector routing.
- Four assembly steps and Thing Plus firmware generated.
- `gpt-image-2` high-quality hero: 209.20 s.
- Request to ready: 224.77 s.
- Local GLB requests: zero. Generated GLBs: zero.

## Verification checklist

- `node --test tests/aws-production-assembly-routing.test.mjs tests/assembly-asset-catalog.test.mjs tests/makeable-builds.test.mjs tests/acacia-registry.test.mjs`
- `npm run build`
- start `scripts/assembly-contract-server.mjs` and `scripts/production-aws-simulation-server.mjs`
- inspect `/api/builds/plant-companion-v1/assembly` and `/api/production-simulations/latest`
- inspect the local `/app/production-simulation.html` viewer at rendered size
- confirm policy enforcement, six remote assets, 11 direct conductors, four steps, and zero local/generated GLBs

## Known limits

The local viewer proves hash-bound remote delivery, endpoint preservation, and deterministic transforms. It does not prove insertion force, connector retention, real-world conductor bend radius, or compatibility of an unverified marketplace expansion board. Those require exact-variant evidence and physical validation.
