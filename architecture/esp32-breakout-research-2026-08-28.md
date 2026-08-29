# ESP32 breakout-board research — 2026-08-28

State: `candidate_review`

This is a procurement and geometry intake, not an approval. No item was purchased, no marketplace variant was selected, and no GLB was uploaded. Amazon was checked as the US marketplace. AliExpress destination, shipping, and currency were not set in an authenticated session, so AliExpress prices are deliberately omitted.

## Global assembly policy

- Breadboards are prohibited by `no-breadboards-v1`.
- A controller can be assembly-ready only through direct labeled pins, an exact keyed factory connector/cable, or an exact compatible expansion board with a reviewed GLB.
- Sharing a chip name is not compatibility evidence. Pin count, row spacing, socket gender, board width, pin order, installed headers, and selected marketplace option must all match.
- One or two sensors may connect directly when voltage, current, signal-pin use, and a real ground termination are verified. Two sensors may share a power rail or ground only through a modeled physical termination.
- Three or more sensors require the exact controller-footprint expansion board. A merely similar pin count or chip family is rejected.
- Generated local candidates remain `candidate_review` until the remaining source/release blockers are cleared and the exact hash is explicitly approved for AWS publication.

## Exact candidates by supported footprint

| Supported Makeable controllers | Footprint | Candidate | Amazon US | AliExpress | Gate |
|---|---|---|---|---|---|
| Seeed XIAO ESP32S3 `B0DRNVH8MQ`; XIAO ESP32C6 `B0DRNW9LJM`; XIAO ESP32C5 `B0GWPZR8C6`; XIAO ESP32C3 `B0DRNSV5CS` | XIAO 14-pin | Seeed Studio Expansion Board Base for XIAO, SKU `103030356` | `B08P4GPR6M` | No exact current item verified | Local deterministic GLB generated. Interface and no-solder assembly are ready from official ECAD; visual release remains `candidate_review` because the post-2025 PMIC package and full markings are simplified. |
| AOICRIE C3 Mini `B0DD3ZB5XV`; DORHEA C3 Mini `B0GR8WYC8C` | ESP32-C3 SuperMini 16-pin | AITRIP expansion-board-only variant | `B0FBGFWFB1` | `1005008585341920` | 37 × 23 mm pin-complete local GLB generated; remains `candidate_review` because the clone schematic/current limits are unpublished. |
| ELEGOO ESP32-WROOM-32 USB-C `B0D8T53CQ5` | ESP32 DevKit V1 30-pin | DORHEA-style GPIO 1-to-2 30-pin expansion board | `B0FT3J8JB2` | `1005005553236672` | `candidate_review`: exact socket spacing and labels missing; never substitute a 38-pin carrier |
| hiBCTR ESP32-S3 N16R8 `B0GVF97WTY`; AITRIP ESP32-S3 DevKitC-1 N8R2 `B0BVVGNBB3` | ESP32-S3 DevKit 44-pin | AITRIP GPIO 1-to-2 44-pin expansion board | `B0H336QRXX` | `1005009901996625` | 82 × 82 mm pin-complete local GLB generated with two 1×22 sockets and duplicated pin banks; remains `candidate_review` because the marketplace clone has no manufacturer ECAD/schematic. |
| SparkFun Thing Plus ESP32 WROOM `B0BC29D9QG` | Thing Plus / Feather 28-pin | SparkFun Qwiic Shield for Thing Plus, `DEV-16790` | No exact Amazon listing retained | No exact AliExpress listing retained | `blocked`: the shield's included headers require soldering; use the controller's native Qwiic socket instead |

## Board-specific layouts with no verified carrier

No exact compatible no-solder carrier was found for these supported catalog controllers. They must use their modeled native connectors/pins or remain blocked; they may not inherit one of the generic carriers above.

- Waveshare ESP32-S3 Mini `B0CSD5NZDJ`
- ESP32-C6 mini `B0CZHJHF7K`
- ESP32-C6-Zero-M `B0D2XSWQWZ`
- ESP32-S3 thermal-camera module `B0DXP783CQ`
- Meshnology ESP32 LoRa V4 `B0GQ3QLB5M`
- ESP32-S3 WROOM N16R8 camera board `B0HBP9HLW9`
- ideaspark ESP32 + 0.96-inch OLED `B0CN4F354N`
- ESP32-C6 1.47-inch RGB display `B0F4DDDQSM`
- ESP32-C6 1.47-inch touch display `B0F99KMRVL`
- ESP32-C6 1.3-inch LCD `B0GJT1X7H5`
- Waveshare ESP32-C5-LCD-1.47-M `B0H6Z84SSN`
- AITRIP ESP32-WROVER camera board `B09ZJTVPNW`
- Waveshare ESP32-C6-LCD-1.47-M `B0DHTMYTCY`
- Waveshare ESP32-S3 AMOLED 1.91-inch `B0DJX8J1JK`
- ESP32-2432S028R smart display `B0CG2WQGP9`
- Waveshare ESP32-S3 2.1-inch round display `B0F18W86GC`

## Primary and marketplace evidence

- Seeed Studio XIAO expansion base product page and SKU: <https://www.seeedstudio.com/Seeeduino-XIAO-Expansion-board-p-4746.html>
- Seeed Studio compatibility and pinout documentation: <https://wiki.seeedstudio.com/Seeeduino-XIAO-Expansion-Board/>
- Seeed Studio 2025 PMIC change notice for SKU `103030356`: <https://files.seeedstudio.com/wiki/Seeeduino-XIAO-Expansion-Board/document/PCN-103030356.pdf>
- SparkFun Qwiic Shield for Thing Plus `DEV-16790`: <https://www.sparkfun.com/sparkfun-qwiic-shield-for-thing-plus.html>
- Amazon XIAO expansion base: <https://www.amazon.com/dp/B08P4GPR6M>
- Amazon C3 SuperMini expansion board: <https://www.amazon.com/dp/B0FBGFWFB1>
- Amazon 30-pin expansion board: <https://www.amazon.com/dp/B0FT3J8JB2>
- Amazon 44-pin ESP32-S3 expansion kit: <https://www.amazon.com/dp/B0H336QRXX>
- AliExpress C3 SuperMini candidate: <https://www.aliexpress.com/item/1005008585341920.html>
- AliExpress 30-pin candidate: <https://www.aliexpress.com/item/1005005553236672.html>
- AliExpress 44-pin ESP32-S3 candidate: <https://www.aliexpress.com/item/1005009901996625.html>

## Production-simulation decision

The plant assembly now uses the SparkFun Thing Plus board's exact native Qwiic connector rather than the solder-required shield. Two exact dual-STEMMA/Qwiic sensor GLBs are daisy-chained controller → TSL2591 → SCD-41. The soil probe's three factory leads connect directly to the controller's labeled 3V3, GND, and A0 pins. This is the only currently ready path because it needs neither a breadboard nor an unreviewed carrier GLB.

## Generated GLB candidates

Each delivery contains the GLB, generator, source/reference files with SHA-256 binding, four-angle render, source-to-render comparison, visual review, delivery validation, and Khronos glTF Validator report.

- `artifacts/high-fidelity-glb/2026-08-28/aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1`
- `artifacts/high-fidelity-glb/2026-08-28/aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx`
- `artifacts/high-fidelity-glb/2026-08-28/seeed-xiao-expansion-base-103030356`

Two consecutive runs produced identical GLB hashes. Khronos validation returned zero errors and zero warnings for all three files. No model was uploaded to AWS and no listing was purchased.
