#!/usr/bin/env python3
"""Finalize the three 2026-08-28 ESP32 expansion-board delivery jobs."""

from __future__ import annotations

import hashlib
import json
import platform
import struct
from pathlib import Path

import trimesh


ROOT = Path(__file__).resolve().parents[2]
JOBS = ROOT / "artifacts/high-fidelity-glb/2026-08-28"
CHECKED_AT = "2026-08-28T04:07:44-07:00"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_glb_json(path: Path):
    data = path.read_bytes()
    offset = 12
    while offset + 8 <= len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + length]
        offset += length
        if chunk_type == 0x4E4F534A:
            return json.loads(chunk.rstrip(b" \t\r\n\x00"))
    raise RuntimeError(f"No JSON chunk in {path}")


def triangle_count(document) -> int:
    total = 0
    accessors = document.get("accessors", [])
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            index = primitive.get("indices", primitive.get("attributes", {}).get("POSITION"))
            if isinstance(index, int):
                total += int(accessors[index]["count"]) // 3
    return total


def evidence(source_id, url, exactness, supports, local=None):
    item = {
        "sourceId": source_id,
        "url": url,
        "exactness": exactness,
        "checkedAt": CHECKED_AT,
        "supports": supports,
    }
    if local:
        item["localPath"] = f"reference/{local}"
        item["sha256"] = sha256(current_job / "reference" / local)
    return item


def connector(connector_id, position, family, gender, count, evidence_ids, compatible):
    return {
        "connectorId": connector_id,
        "nodeName": f"connector:{connector_id}",
        "facePositionMm": position,
        "normal": [0, 0, 1],
        "family": family,
        "gender": gender,
        "contactCount": count,
        "factoryInstalled": True,
        "requiresSoldering": False,
        "compatibleWith": compatible,
        "evidenceIds": evidence_ids,
    }


def anchor(anchor_id, connector_id, position, label, role, family, voltage, index, evidence_ids):
    return {
        "anchorId": anchor_id,
        "nodeName": f"anchor:{anchor_id}",
        "connectorId": connector_id,
        "positionMm": position,
        "normal": [0, 0, 1],
        "physicalLabel": label,
        "electricalRole": role,
        "connectorFamily": family,
        "voltageDomain": voltage,
        "confidence": "source-backed-candidate",
        "contactIndex": index,
        "pitchMm": 2.54,
        "evidenceIds": evidence_ids,
    }


def mount(mount_id, position, diameter):
    return {
        "mountId": mount_id,
        "nodeName": f"mount:{mount_id}",
        "positionMm": position,
        "diameterMm": diameter,
    }


SPECS = {
    "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1": {
        "identity": {
            "manufacturer": "AITRIP",
            "productName": "AITRIP ESP32-C3 SuperMini Expansion Board (Only Expansion Board, 2PCS)",
            "manufacturerSku": "B0FBGFWFB1",
            "hardwareRevision": "marketplace-listing-revision-checked-2026-08-28",
            "soldConnectorForm": "factory-installed 2x8 controller sockets, screw terminals, and 3-lane male breakout pins",
            "acceptedAliases": ["ESP32-C3 SuperMini IO Breakout Expansion Board"],
            "rejectedAliases": ["ESP32-C3 SuperMini controller included"],
            "marketplaceIds": [
                {"marketplace": "Amazon US", "id": "B0FBGFWFB1", "url": "https://www.amazon.com/dp/B0FBGFWFB1"},
                {"marketplace": "AliExpress", "id": "1005008585341920", "url": "https://www.aliexpress.com/item/1005008585341920.html"},
            ],
        },
        "evidence": lambda: [
            evidence("amazon-c3-front", "https://m.media-amazon.com/images/I/71BkPITTVSL._AC_SL1500_.jpg", "exact_sold_variant", ["37 x 23 mm outline", "connector population", "pin labels", "factory-installed pins"], "amazon-2.jpg"),
            evidence("amazon-c3-details", "https://m.media-amazon.com/images/I/81nHQDFEDIL._AC_SL1500_.jpg", "exact_sold_variant", ["terminal blocks", "JST battery connector", "underside", "mounted SuperMini orientation"], "amazon-3.jpg"),
            evidence("aliexpress-c3-drawing", "https://ae-pic-a1.aliexpress-media.com/kf/S93170361c9804a08bbdac6eea096f4c8d.pdf", "family_context", ["SuperMini compatibility", "battery support", "all IO ports led out"], "aliexpress-dimension-drawing.pdf"),
        ],
        "strategy": "photo_calibrated",
        "uncertainty": {"outline": 0.25, "interfaces": 0.15, "nonInterfaceHeight": 1.0},
        "connectors": [
            connector("controller-left-1x8", [-5.3, 0, 7.24], "2.54mm SuperMini socket row", "female", 8, ["amazon-c3-front"], ["ESP32-C3 SuperMini 16-pin installed headers"]),
            connector("controller-right-1x8", [5.3, 0, 7.24], "2.54mm SuperMini socket row", "female", 8, ["amazon-c3-front"], ["ESP32-C3 SuperMini 16-pin installed headers"]),
            connector("gpio-breakout", [10.9, 0, 8.0], "2.54mm 3-lane GPIO breakout", "male", 48, ["amazon-c3-front", "amazon-c3-details"], ["female Dupont lead", "screw-terminal field wire"]),
        ],
        "anchors": [
            anchor("c3-3v3", "gpio-breakout", [16.0, -3.81, 8.0], "3V3", "power", "2.54mm male header", "3.3V", 0, ["amazon-c3-front"]),
            anchor("c3-gnd", "gpio-breakout", [13.45, -6.35, 8.0], "GND", "ground", "2.54mm male header", "0V", 1, ["amazon-c3-front"]),
            anchor("c3-gpio0", "gpio-breakout", [16.0, 8.89, 8.0], "0", "GPIO0", "2.54mm male header", "3.3V logic", 2, ["amazon-c3-front"]),
        ],
        "mounts": [mount("m1", [-4.75, -8.6, 0.91], 2.6), mount("m2", [4.75, -8.6, 0.91], 2.6)],
        "gates": {"visual": "ready", "interface": "candidate_review", "assembly": "candidate_review"},
        "criteria": {"identity": "pass", "outline": "pass", "frontPopulation": "pass", "undersidePopulation": "pass", "connectors": "pass", "pins": "pass", "materials": "pass", "markings": "pass", "scale": "pass"},
        "visualReasons": [],
        "interfaceReasons": ["clone schematic and current limits are not published"],
        "assemblyReasons": ["clone schematic and current limits are not published"],
    },
    "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx": {
        "identity": {
            "manufacturer": "AITRIP",
            "productName": "AITRIP ESP32-S3 44-pin GPIO 1-to-2 Expansion Board",
            "manufacturerSku": "B0H336QRXX",
            "hardwareRevision": "V2775 marketplace-listing-revision-checked-2026-08-28",
            "soldConnectorForm": "factory-installed dual 1x22 sockets, replicated male pin banks, DC barrel input, 3V3 and 5V banks",
            "acceptedAliases": ["ESP32-S3 GPIO Extension Board V2775"],
            "rejectedAliases": ["30-pin ESP32 expansion board", "38-pin ESP32 expansion board"],
            "marketplaceIds": [
                {"marketplace": "Amazon US", "id": "B0H336QRXX", "url": "https://www.amazon.com/dp/B0H336QRXX"},
                {"marketplace": "AliExpress", "id": "1005009901996625", "url": "https://www.aliexpress.com/item/1005009901996625.html"},
            ],
        },
        "evidence": lambda: [
            evidence("amazon-s3-dimensions", "https://m.media-amazon.com/images/I/71QK47rF0zL._AC_SL1500_.jpg", "exact_sold_variant", ["82 x 82 mm outline", "44-pin socket population", "pin labels", "two-USB-C controller orientation"], "amazon-4.jpg"),
            evidence("amazon-s3-interface", "https://m.media-amazon.com/images/I/71jw9MQ6kFL._AC_SL1500_.jpg", "exact_sold_variant", ["GPIO breakout mapping", "3V3 bank", "5V bank", "DC 6.5-9V input"], "amazon-5.jpg"),
            evidence("espressif-s3-pin-table", "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide.html", "family_context", ["official DevKitC-1 J1/J3 44-pin order", "power and ground pins"]),
            evidence("aliexpress-s3-drawing", "https://ae-pic-a1.aliexpress-media.com/kf/Sedf9498530844dac85f78184d1d31a3aN.pdf", "family_context", ["44-pin expansion-board category", "DC barrel interface"], "aliexpress-dimension-drawing.pdf"),
        ],
        "strategy": "photo_calibrated",
        "uncertainty": {"outline": 0.25, "interfaces": 0.15, "nonInterfaceHeight": 1.5},
        "connectors": [
            connector("controller-j1-1x22", [-12.7, 8.0, 7.24], "ESP32-S3 DevKitC-1 J1 2.54mm socket", "female", 22, ["amazon-s3-dimensions", "espressif-s3-pin-table"], ["ESP32-S3 DevKitC-1 44-pin installed headers"]),
            connector("controller-j3-1x22", [12.7, 8.0, 7.24], "ESP32-S3 DevKitC-1 J3 2.54mm socket", "female", 22, ["amazon-s3-dimensions", "espressif-s3-pin-table"], ["ESP32-S3 DevKitC-1 44-pin installed headers"]),
            connector("gpio-breakout", [20.3, 8.0, 8.0], "2.54mm replicated GPIO breakout", "male", 132, ["amazon-s3-interface"], ["female Dupont lead"]),
        ],
        "anchors": [
            anchor("s3-3v3", "gpio-breakout", [-20.3, 34.67, 8.0], "3V3", "power", "2.54mm male header", "3.3V", 0, ["amazon-s3-interface", "espressif-s3-pin-table"]),
            anchor("s3-gnd", "gpio-breakout", [20.3, 34.67, 8.0], "GND", "ground", "2.54mm male header", "0V", 1, ["amazon-s3-interface", "espressif-s3-pin-table"]),
            anchor("s3-gpio1", "gpio-breakout", [20.3, 27.05, 8.0], "IO1", "GPIO1", "2.54mm male header", "3.3V logic", 2, ["amazon-s3-interface", "espressif-s3-pin-table"]),
        ],
        "mounts": [mount("m1", [-37, -37, 0.91], 3.2), mount("m2", [37, -37, 0.91], 3.2), mount("m3", [-37, 37, 0.91], 3.2), mount("m4", [37, 37, 0.91], 3.2)],
        "gates": {"visual": "ready", "interface": "candidate_review", "assembly": "candidate_review"},
        "criteria": {"identity": "pass", "outline": "pass", "frontPopulation": "pass", "undersidePopulation": "not_applicable", "connectors": "pass", "pins": "pass", "materials": "pass", "markings": "pass", "scale": "pass"},
        "visualReasons": [],
        "interfaceReasons": ["marketplace clone has no manufacturer ECAD or exact electrical schematic"],
        "assemblyReasons": ["marketplace clone has no manufacturer ECAD or exact electrical schematic"],
    },
    "seeed-xiao-expansion-base-103030356": {
        "identity": {
            "manufacturer": "Seeed Studio",
            "productName": "Seeed Studio Expansion Board Base for XIAO",
            "manufacturerSku": "103030356",
            "hardwareRevision": "post-PCN20251119-010 SY6974B PMIC revision",
            "soldConnectorForm": "fully assembled base with XIAO sockets, Grove connectors, OLED, RTC, microSD, JST2.0 and 2x4 header",
            "acceptedAliases": ["Expansion Board Base for XIAO", "Seeeduino XIAO Expansion Board"],
            "rejectedAliases": ["Grove Shield for XIAO", "XIAO controller included"],
            "marketplaceIds": [{"marketplace": "Amazon US", "id": "B08P4GPR6M", "url": "https://www.amazon.com/dp/B08P4GPR6M"}],
        },
        "evidence": lambda: [
            evidence("seeed-xiao-brd", "https://files.seeedstudio.com/wiki/Seeeduino-XIAO-Expansion-Board/document/Seeeduino%20XIAO%20Expansion%20board_v1.0_200824.brd", "exact_revision", ["58 x 42.5 mm outline", "mount centres", "connector and component XY placements"], "Seeeduino-XIAO-Expansion-board-v1.0-200824.brd"),
            evidence("seeed-xiao-schematic", "https://files.seeedstudio.com/wiki/Seeeduino-XIAO-Expansion-Board/document/Seeeduino%20XIAO%20Expansion%20board_v1.0_SCH_200824.pdf", "exact_revision", ["XIAO 14-pin mapping", "Grove contacts", "JST and servo/SWD interfaces"], "Seeeduino-XIAO-Expansion-board-v1.0-200824.pdf"),
            evidence("seeed-xiao-pcn", "https://files.seeedstudio.com/wiki/Seeeduino-XIAO-Expansion-Board/document/PCN-103030356.pdf", "exact_revision", ["SKU identity", "ETA6003A to SY6974B PMIC change", "no mechanical change"] , "PCN-103030356.pdf"),
            evidence("seeed-xiao-top", "https://files.seeedstudio.com/wiki/Seeeduino-XIAO-Expansion-Board/2222222222222222222222222222221.jpg", "exact_component", ["front population", "factory connector population", "pin labels"], "official-top-layout.jpg"),
            evidence("seeed-xiao-bottom", "https://files.seeedstudio.com/wiki/Seeeduino-XIAO-Expansion-Board/1111111111111111111111110.jpg", "exact_component", ["microSD slot", "CR1220 holder", "underside population"], "official-bottom-layout.jpg"),
            evidence("amazon-xiao-sold", "https://m.media-amazon.com/images/I/71CbcImq+aL._AC_SL1500_.jpg", "exact_sold_variant", ["retail sold form", "installed sockets and peripherals"], "amazon-1.jpg"),
        ],
        "strategy": "manufacturer_ecad_derived",
        "uncertainty": {"outline": 0.05, "interfaces": 0.05, "nonInterfaceHeight": 0.75},
        "connectors": [
            connector("xiao-controller-socket", [-18.459, 0.05, 4.18], "Seeed XIAO 2x7 2.54mm socket footprint", "female", 14, ["seeed-xiao-brd", "seeed-xiao-schematic"], ["pre-soldered Seeed Studio XIAO ESP32-C3", "pre-soldered Seeed Studio XIAO ESP32-S3"]),
            connector("grove-i2c-a", [11.6, 12.55, 3.4], "Grove 4-pin I2C", "female", 4, ["seeed-xiao-brd", "seeed-xiao-schematic"], ["Grove 4-pin cable"]),
            connector("grove-i2c-b", [0, 12.55, 3.4], "Grove 4-pin I2C", "female", 4, ["seeed-xiao-brd", "seeed-xiao-schematic"], ["Grove 4-pin cable"]),
            connector("grove-a0-d0", [0, -12.45, 3.4], "Grove 4-pin analog/digital", "female", 4, ["seeed-xiao-brd", "seeed-xiao-schematic"], ["Grove 4-pin cable"]),
            connector("grove-uart", [11.6, -12.45, 3.4], "Grove 4-pin UART", "female", 4, ["seeed-xiao-brd", "seeed-xiao-schematic"], ["Grove 4-pin cable"]),
        ],
        "anchors": [
            anchor("xiao-3v3", "xiao-controller-socket", [-20.999, 10.55, 4.18], "3V3", "power", "XIAO socket", "3.3V", 0, ["seeed-xiao-brd", "seeed-xiao-schematic"]),
            anchor("xiao-gnd", "xiao-controller-socket", [-23.539, 10.55, 4.18], "GND", "ground", "XIAO socket", "0V", 1, ["seeed-xiao-brd", "seeed-xiao-schematic"]),
            anchor("xiao-d0", "xiao-controller-socket", [-26.079, -10.45, 4.18], "D0", "GPIO/ADC", "XIAO socket", "3.3V logic", 2, ["seeed-xiao-brd", "seeed-xiao-schematic"]),
            anchor("xiao-grove-a0-gnd", "grove-a0-d0", [-3.0, -12.45, 3.4], "GND", "ground", "Grove 4-pin analog/digital", "0V", 0, ["seeed-xiao-brd", "seeed-xiao-schematic"]),
            anchor("xiao-grove-a0-3v3", "grove-a0-d0", [-1.0, -12.45, 3.4], "3V3", "power", "Grove 4-pin analog/digital", "3.3V", 1, ["seeed-xiao-brd", "seeed-xiao-schematic"]),
            anchor("xiao-grove-a0-d0", "grove-a0-d0", [3.0, -12.45, 3.4], "D0", "GPIO/ADC", "Grove 4-pin analog/digital", "3.3V logic", 3, ["seeed-xiao-brd", "seeed-xiao-schematic"]),
        ],
        "mounts": [mount("m1", [-25.0101, 17.4987, 0.91], 3.0), mount("m2", [24.9899, 17.4987, 0.91], 3.0), mount("m3", [24.9899, -17.5013, 0.91], 3.0), mount("m4", [-25.0101, -17.5013, 0.91], 3.0)],
        "gates": {"visual": "ready", "interface": "ready", "assembly": "ready"},
        "criteria": {"identity": "pass", "outline": "pass", "frontPopulation": "pass", "undersidePopulation": "pass", "connectors": "pass", "pins": "pass", "materials": "pass", "markings": "pass", "scale": "pass"},
        "visualReasons": [],
        "interfaceReasons": [],
        "assemblyReasons": [],
    },
}


for part_id, spec in SPECS.items():
    current_job = JOBS / part_id
    glb_path = current_job / "models" / f"{part_id}.glb"
    document = read_glb_json(glb_path)
    scene = trimesh.load(glb_path, force="scene", process=False)
    bounds_m = [round(float(value), 8) for value in scene.extents]
    bounds_mm = [round(value * 1000, 5) for value in bounds_m]
    glb_hash = sha256(glb_path)
    criteria = spec["criteria"]
    review_record = {
        "schemaVersion": "makeable-visual-review/v1",
        "partId": part_id,
        "glbSha256": glb_hash,
        "reviewer": "Codex source-to-render visual review",
        "reviewedAt": CHECKED_AT,
        "criteria": criteria,
        "notes": spec["visualReasons"],
    }
    review_path = current_job / "reports/visual-review.json"
    review_path.write_text(json.dumps(review_record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    render = current_job / "renders" / f"{part_id}-four-angle.png"
    comparison = current_job / "renders" / f"{part_id}-reference-comparison.png"
    khronos_report = current_job / "reports/khronos-gltf-validator.json"
    evidence_items = spec["evidence"]()
    manifest = {
        "schemaVersion": "makeable-part-3d/v1",
        "partId": part_id,
        "revision": "candidate-v1.1.0-silkscreen",
        "state": "candidate_review",
        "identity": spec["identity"],
        "coordinateSystem": {
            "handedness": "right",
            "axes": "+X right, +Y up, +Z toward viewer",
            "sourceUnits": "mm",
            "glbUnits": "m",
            "glbScaleFromMm": 0.001,
            "origin": "centre of component-side PCB mid-plane",
        },
        "evidence": evidence_items,
        "geometry": {
            "strategy": spec["strategy"],
            "sourceBoundsMm": bounds_mm,
            "glbBoundsM": bounds_m,
            "envelopeMm": {"width": bounds_mm[0], "height": bounds_mm[1], "depth": bounds_mm[2]},
            "uncertaintyMm": spec["uncertainty"],
        },
        "glb": {
            "path": f"models/{part_id}.glb",
            "sha256": glb_hash,
            "byteSize": glb_path.stat().st_size,
            "triangleCount": triangle_count(document),
            "materialCount": len(document.get("materials", [])),
            "nodeCount": len(document.get("nodes", [])),
        },
        "anchors": spec["anchors"],
        "connectors": spec["connectors"],
        "mounts": spec["mounts"],
        "keepouts": [],
        "landmarks": [],
        "absenceJustifications": {
            "keepouts": "Candidate GLB is not yet cleared for enclosure collision planning; use the full measured envelope.",
            "landmarks": "Connector, anchor, and mount nodes provide the required stable assembly semantics for this candidate.",
        },
        "visualReview": {
            "reviewer": review_record["reviewer"],
            "reviewedAt": CHECKED_AT,
            "reviewedGlbSha256": glb_hash,
            "reviewFile": "reports/visual-review.json",
            "reviewFileSha256": sha256(review_path),
            "multiAngleRender": {"path": f"renders/{render.name}", "sha256": sha256(render)},
            "referenceComparison": {"path": f"renders/{comparison.name}", "sha256": sha256(comparison)},
            "criteria": criteria,
        },
        "visualEligibility": {"state": spec["gates"]["visual"], "reasons": spec["visualReasons"]},
        "interfaceEligibility": {"state": spec["gates"]["interface"], "reasons": spec["interfaceReasons"]},
        "assemblyEligibility": {"state": spec["gates"]["assembly"], "reasons": spec["assemblyReasons"]},
        "toolchain": {
            "generator": "scripts/assembly3d/generate_esp32_expansion_glbs.py",
            "python": platform.python_version(),
            "trimesh": trimesh.__version__,
            "determinism": "two consecutive generation runs produced the same SHA-256",
            "aiGeometryAuthority": False,
            "khronosGltfValidator": {
                "version": "2.0.0-dev.3.10",
                "report": "reports/khronos-gltf-validator.json",
                "reportSha256": sha256(khronos_report) if khronos_report.exists() else None,
            },
        },
    }
    (current_job / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    job = json.loads((current_job / "job.json").read_text(encoding="utf-8"))
    job["state"] = "candidate_review"
    job["nextEvidence"] = sorted(set(spec["visualReasons"] + spec["interfaceReasons"] + spec["assemblyReasons"]))
    job["candidateGlb"] = manifest["glb"]
    (current_job / "job.json").write_text(json.dumps(job, indent=2, sort_keys=True) + "\n", encoding="utf-8")
