#!/usr/bin/env python3
"""Create deterministic installed-header GLBs for the five approved bare-hole boards.

The reviewed manufacturer/carrier GLB remains the immutable base.  This script
verifies its SHA-256, preserves that scene, and adds only the sold/assembled
0.1-inch header population requested by the Makeable catalog contract.  Pin
centres come from the exact manufacturer Eagle files or the exact carrier's
documented 2.54 mm header grid; they are not inferred from pixels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh


@dataclass(frozen=True)
class Pin:
    row: str
    index: int
    label: str
    x_mm: float
    y_mm: float


@dataclass(frozen=True)
class Asset:
    part_id: str
    base_url: str
    base_sha256: str
    base_revision: str
    board_bottom_mm: float
    board_top_mm: float
    pins: tuple[Pin, ...]


def row(row_id: str, labels: list[str], points: list[tuple[float, float]]) -> list[Pin]:
    if len(labels) != len(points):
        raise ValueError(f"{row_id}: label/point mismatch")
    return [Pin(row_id, index + 1, label, *point) for index, (label, point) in enumerate(zip(labels, points))]


ESP_LEFT = ["3V3", "3V3_2", "EN", "GPIO4", "GPIO5", "GPIO6", "GPIO7", "GPIO15", "GPIO16", "GPIO17", "GPIO18", "GPIO8", "GPIO3", "GPIO46", "GPIO9", "GPIO10", "GPIO11", "GPIO12", "GPIO13", "GPIO14", "5V", "GND_L"]
ESP_RIGHT = ["GND_R1", "TX", "RX", "GPIO1", "GPIO2", "GPIO42", "GPIO41", "GPIO40", "GPIO39", "GPIO38", "GPIO37", "GPIO36", "GPIO35", "GPIO0", "GPIO45", "GPIO48", "GPIO47", "GPIO21", "GPIO20", "GPIO19", "GND_R2", "GND_R3"]
ESP_Y = [26.67 - 2.54 * index for index in range(22)]


ASSETS = (
    Asset(
        "adafruit-bno055-orientation-breakout-2472",
        "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/1c2cd0932c51cb205ee8dbd438b1bbc2689ea3445e89886e9fed89a8327b83f9.glb",
        "1c2cd0932c51cb205ee8dbd438b1bbc2689ea3445e89886e9fed89a8327b83f9",
        "adafruit-official-step-photo-visual-v1.0.0",
        0.0,
        1.6,
        tuple(
            row("main", ["5V", "3V3", "GND", "SDA", "SCL", "RST"], [(6.985 + 2.54 * index, 1.27) for index in range(6)])
            + row("aux", ["PS0", "PS1", "INT", "ADR"], [(9.525 + 2.54 * index, 19.05) for index in range(4)])
        ),
    ),
    Asset(
        "adafruit-pn532-nfc-breakout-364",
        "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/34257007268a4c9bf51227d0287efbc60e0c768b95427333169654811cc9040a.glb",
        "34257007268a4c9bf51227d0287efbc60e0c768b95427333169654811cc9040a",
        "adafruit-official-step-photo-visual-v1.0.0",
        0.0,
        1.6,
        tuple(
            row("interface", ["VDD", "SCK", "MISO", "MOSI_SDA_TX", "NSS_SCL_RX", "RSTOUT_N", "IRQ", "GND"], [(116.534, 33.56 - 2.54 * index) for index in range(8)])
            + row("sel0", ["SEL0_VDD", "SEL0", "SEL0_GND"], [(88.684 + 2.54 * index, 8.51) for index in range(3)])
            + row("sel1", ["SEL1_VDD", "SEL1", "SEL1_GND"], [(97.794 + 2.54 * index, 8.51) for index in range(3)])
        ),
    ),
    Asset(
        "esp32-s3-devkit-n16r8",
        "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/8913f36a92fc1953e5c594fdaccdb0c07f6558685e3463982347ed85bb756576.glb",
        "8913f36a92fc1953e5c594fdaccdb0c07f6558685e3463982347ed85bb756576",
        "approved-visual-catalog-20260828-recovered-v1",
        -0.91,
        0.91,
        tuple(row("left", ESP_LEFT, [(-12.7, y) for y in ESP_Y]) + row("right", ESP_RIGHT, [(12.7, y) for y in ESP_Y])),
    ),
    Asset(
        "esp32-s3-devkitc-1-n8r2",
        "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/1447120b9410cf1d8e0b6daa169e58cf179c1397a02f3fdc5c84c4c5f0c221e3.glb",
        "1447120b9410cf1d8e0b6daa169e58cf179c1397a02f3fdc5c84c4c5f0c221e3",
        "aitrip-b0bvvgnbb3-yd-esp32-s3-n8r2-bare-visual-v1.0.0",
        -0.91,
        0.91,
        tuple(row("left", ESP_LEFT, [(-12.7, y) for y in ESP_Y]) + row("right", ESP_RIGHT, [(12.7, y) for y in ESP_Y])),
    ),
    Asset(
        "sparkfun-hx711-load-cell-amplifier-sen-13879",
        "https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256/c124f44fcd4f4aae586978e953454d88391a509c78f63dec6b3fd002dd20821d.glb",
        "c124f44fcd4f4aae586978e953454d88391a509c78f63dec6b3fd002dd20821d",
        "approved-visual-catalog-20260828-recovered-v1",
        -0.97,
        0.97,
        tuple(
            row("load", ["RED", "BLK", "WHT", "GRN", "YLW"], [(-13.97, 5.08 - 2.54 * index) for index in range(5)])
            + row("host", ["VDD", "VCC", "DAT", "CLK", "GND"], [(13.97, 5.08 - 2.54 * index) for index in range(5)])
            + row("bridge_b", ["B_PLUS", "B_MINUS"], [(6.35, 0.0), (6.35, -2.54)])
        ),
    ),
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", value).strip("_")


def material(name: str, rgba: tuple[int, int, int, int]) -> trimesh.visual.material.PBRMaterial:
    return trimesh.visual.material.PBRMaterial(
        name=name,
        baseColorFactor=np.asarray(rgba, dtype=np.uint8),
        metallicFactor=0.15 if name == "header-pin-gold" else 0.0,
        roughnessFactor=0.28 if name == "header-pin-gold" else 0.68,
    )


GOLD = material("header-pin-gold", (204, 154, 53, 255))
BLACK = material("header-housing-black", (18, 20, 22, 255))
SOLDER = material("header-solder-tin", (180, 186, 188, 255))


def set_material(mesh: trimesh.Trimesh, value: trimesh.visual.material.PBRMaterial) -> trimesh.Trimesh:
    mesh.visual = trimesh.visual.TextureVisuals(material=value)
    return mesh


def translation(x: float, y: float, z: float) -> np.ndarray:
    matrix = np.eye(4)
    matrix[:3, 3] = (x, y, z)
    return matrix


def add_header_scene(scene: trimesh.Scene, asset: Asset) -> dict:
    pin_bottom = asset.board_bottom_mm - 8.5
    pin_top = asset.board_top_mm + 1.4
    pin_height = pin_top - pin_bottom
    housing_bottom = asset.board_bottom_mm - 3.2
    housing_top = asset.board_bottom_mm - 0.05

    scene.graph.update(
        frame_from="world",
        frame_to=f"profile:{asset.part_id}:installed-header-v1",
        matrix=np.eye(4),
    )

    groups: dict[str, list[Pin]] = {}
    for pin in asset.pins:
        groups.setdefault(pin.row, []).append(pin)

    for row_id, pins in groups.items():
        xs = [pin.x_mm for pin in pins]
        ys = [pin.y_mm for pin in pins]
        horizontal = (max(xs) - min(xs)) >= (max(ys) - min(ys))
        x_size = (max(xs) - min(xs) + 2.5) if horizontal else 2.5
        y_size = 2.5 if horizontal else (max(ys) - min(ys) + 2.5)
        housing = set_material(
            trimesh.creation.box(extents=(x_size / 1000, y_size / 1000, (housing_top - housing_bottom) / 1000)),
            BLACK,
        )
        scene.add_geometry(
            housing,
            node_name=f"header-housing:{row_id}",
            geom_name=f"geometry:header-housing:{row_id}",
            transform=translation(np.mean(xs) / 1000, np.mean(ys) / 1000, (housing_top + housing_bottom) / 2000),
        )

    anchors = []
    for pin in asset.pins:
        semantic = f"{pin.row}:{pin.index}:{safe_name(pin.label)}"
        pin_mesh = set_material(trimesh.creation.box(extents=(0.64 / 1000, 0.64 / 1000, pin_height / 1000)), GOLD)
        scene.add_geometry(
            pin_mesh,
            node_name=f"pin:{semantic}",
            geom_name=f"geometry:pin:{semantic}",
            transform=translation(pin.x_mm / 1000, pin.y_mm / 1000, (pin_top + pin_bottom) / 2000),
        )
        solder = set_material(trimesh.creation.icosphere(subdivisions=2, radius=0.52 / 1000), SOLDER)
        solder.apply_scale((1.0, 1.0, 0.34))
        scene.add_geometry(
            solder,
            node_name=f"solder:{semantic}",
            geom_name=f"geometry:solder:{semantic}",
            transform=translation(pin.x_mm / 1000, pin.y_mm / 1000, (asset.board_top_mm + 0.18) / 1000),
        )
        anchor_name = f"anchor:{semantic}"
        scene.graph.update(
            frame_from="world",
            frame_to=anchor_name,
            matrix=translation(pin.x_mm / 1000, pin.y_mm / 1000, pin_bottom / 1000),
        )
        anchors.append({
            "anchorId": anchor_name,
            "label": pin.label,
            "row": pin.row,
            "index": pin.index,
            "positionMm": [pin.x_mm, pin.y_mm, pin_bottom],
            "normal": [0, 0, -1],
            "connectorFamily": "2.54mm_male_header",
            "pitchMm": 2.54,
        })
    return {
        "partId": asset.part_id,
        "baseRevision": asset.base_revision,
        "baseSha256": asset.base_sha256,
        "revision": f"{asset.base_revision}-installed-header-v1",
        "geometryQualification": "Base GLB unchanged; exact 2.54 mm functional through-hole centres populated with modeled installed male headers.",
        "anchors": anchors,
    }


def fetch_verified(asset: Asset, destination: Path) -> bytes:
    request = urllib.request.Request(asset.base_url, headers={"Accept": "model/gltf-binary", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
    digest = sha256_bytes(data)
    if digest != asset.base_sha256:
        raise RuntimeError(f"{asset.part_id}: base SHA mismatch: {digest} != {asset.base_sha256}")
    destination.write_bytes(data)
    return data


def build(asset: Asset, output_dir: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix=f"makeable-{asset.part_id}-") as temporary:
        source = Path(temporary) / "base.glb"
        fetch_verified(asset, source)
        scene = trimesh.load(source, force="scene", process=False)
        record = add_header_scene(scene, asset)
        output = output_dir / f"{asset.part_id}.glb"
        glb = trimesh.exchange.gltf.export_glb(scene, include_normals=True)
        output.write_bytes(glb)
        reloaded = trimesh.load(output, force="scene", process=False)
        anchor_names = sorted(name for name in reloaded.graph.nodes if str(name).startswith("anchor:"))
        expected_names = sorted(item["anchorId"] for item in record["anchors"])
        if anchor_names != expected_names:
            raise RuntimeError(f"{asset.part_id}: exported anchor set mismatch")
        if not np.isfinite(reloaded.bounds).all():
            raise RuntimeError(f"{asset.part_id}: non-finite exported bounds")
        record.update({
            "glbPath": str(output),
            "glbSha256": sha256_bytes(glb),
            "bytes": len(glb),
            "triangles": int(sum(len(mesh.faces) for mesh in reloaded.geometry.values())),
            "boundsMm": np.round(reloaded.bounds * 1000, 6).tolist(),
            "anchorCount": len(anchor_names),
        })
        return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    records = [build(asset, args.output_dir) for asset in ASSETS]
    manifest_path = args.manifest or args.output_dir / "installed-header-manifest.json"
    manifest = {
        "schemaVersion": "MakeableInstalledHeaderAssetBatchV1",
        "revision": "user-approved-installed-headers-2026-08-27-v1",
        "units": "metres in GLB; millimetres in evidence fields",
        "assets": records,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"manifest": str(manifest_path), "assets": records}, indent=2))


if __name__ == "__main__":
    main()
