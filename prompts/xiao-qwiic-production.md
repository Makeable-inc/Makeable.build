# XIAO Qwiic production simulation prompt

This prompt is the build-specific production profile derived from `assembly.md` and the Makeable High-Fidelity GLB skill. It is consumed server-side by the API runner. It is not a visual-review checklist.

## Immutable identity lock

- Controller: Seeed Studio XIAO ESP32C3, exact pre-soldered Amazon variant `B0DRNSV5CS`.
- Sensor: Adafruit SCD-41 CO2, temperature, and humidity breakout #5190, exact catalog variant `B0DYVCTTCD`.
- Cable: Adafruit #4397 STEMMA QT/Qwiic JST-SH 4-pin cable to four premium female sockets, exact variant `B09WLRBKWT`.
- Controller-side contacts: the four separate factory-housed female sockets mate directly with the XIAO's exposed male pins `3V3`, `GND`, `D4/SDA`, and `D5/SCL`.
- Sensor-side connector family: exactly `jst_sh_1.0mm_4p_qwiic`; do not call it Grove, generic JST, Dupont, or USB-C.
- Build name: Pocket CO2 Climate Beacon.
- Shared geometry contract: `config/xiao-qwiic-product-design.json`; envelope 67 × 55 × 34.2 mm, controller placement -18/13/28 mm, sensor placement 16/-5/10 mm, 20 × 14 mm sensor airflow region, and 10 × 7 mm rear USB-C opening.

## Production model roles

- `gpt-5.6-terra` may describe the useful product plan and safety gates. It may not change the exact BOM, pins, cable, GLB identities, or electrical graph.
- `gpt-5.6-sol` may choose only presentation metadata from the preflight-proven safe domain for the already-locked cable conductors: shallow bow direction, lane -1/0/1, and 4.5-5.5 mm bow height. It may not author or move endpoints.
- `gpt-5.6-sol` may write one hero-art prompt for the exact locked product.
- `gpt-image-2` generates one hero image at high quality.
- No model may invent a breakout board, breadboard, connector, extra sensor, display, battery, or wire endpoint.

## Assembly and electrical contract

1. Use no solderless breadboard and no hidden rail or junction.
2. There is no XIAO expansion base in this one-sensor build.
3. The cable is one exact factory assembly with a keyed Qwiic/STEMMA QT plug at the sensor and four individual housed female sockets at the controller.
4. Lock the controller endpoints to the named AWS GLB interface nodes for `3V3`, `GND`, `D4`, and `D5`.
5. Lock the sensor endpoint to `anchor:CONN4_STEMMA_QT` and its four named contact-tip meshes.
6. Use the standard 3.3 V I2C mapping: black GND, red 3V3, blue SDA, yellow SCL. D4 is SDA and D5 is SCL for this locked XIAO contract.
7. The XIAO male pins protrude below the PCB. Each female socket must cover the underside exposed shank and the conductor must leave the rear of that socket before curving.
8. The sensor connector is side-entry and keyed. The cable must enter the connector cavity; it must not land on the PCB, silkscreen, sensor can, or a guessed centre point.
9. USB-C is service and power only. Zero sensor conductors may terminate on or near the USB-C shell.
10. Keep every endpoint immutable. Sol may return only `wireId`, `bowDirection`, `lane`, and `bowHeightMm`.
11. Never coil or loop excess cable. Render one open, shallow, non-self-intersecting bend from the locked endpoint positions/normals. A route with a circle, closed turn, overlap, knot, self-intersection, or repeated traversal is invalid and must fail before rendering; also reject every USB-C keepout intersection.
12. The XIAO direct-socket rule applies only to the exact pre-soldered XIAO variants. A C3 Super Mini must use only its exact C3 Super Mini carrier when three or more sensors are requested; a 44-pin ESP32-S3 DevKit must use only its exact 44-pin carrier. Neither carrier inherits XIAO Qwiic/Grove capability.

## Hero and housing contract

- The hero is one complete, closed, non-exploded product photographed in a restrained industrial-design studio setting.
- Show a compact opaque matte FDM enclosure with one honest snap-fit seam, a rear/underside USB-C service opening that is not visible to camera, and a functional airflow grille aligned to the SCD-41.
- No transparent shell, open chassis, floating electronics, assembly diagram, labels, fake UI, display, buttons, screws, logo, or duplicate product.
- Generate exactly one hero. Do not inspect it, score it, compare it with a reference, correct it, or retry it.
- Start deterministic housing generation only after the hero response exists and its SHA-256 is recorded.
- The housing must be derived from the same locked structured dimensions and keepouts used in the hero prompt, not from a visual interpretation of hero pixels.
- The housing becomes `ready` only after all three printable bodies are watertight, winding-consistent, finite, positive-volume, single-component meshes and two clean generations have byte-identical hashes. These are geometry gates, not visual passes.

## API-only and fail-closed rules

- Use real server-side API calls. Do not substitute deterministic prose, mock model output, a cached hero, or a local GLB when an API or AWS fetch fails.
- Fetch electronics GLBs only from the approved CloudFront origin, verify HTTPS, content type, byte length, SHA-256, and required named nodes in memory.
- Do not upload or overwrite AWS objects in the runtime build. Catalog-maintenance publication is a separate pre-runtime operation.
- Do not invoke a paid AI 3D mesh service. The approved AWS electronics GLBs are the source of truth; the housing is deterministic local CAD after the hero API.
- Human and model visual-pass counts must remain exactly zero.
