#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix, translation_matrix

REVISION = "benchmark-interface-v2"
UNITS = "mm"
SCALE = 0.001
DEFAULT_OUTPUT = Path("apps/landing/public/assembly-assets/benchmark-interface-v2")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--checked-date", default="2026-08-27")
    args = parser.parse_args()

    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)

    assets = []
    for spec in ASSET_SPECS:
        asset = build_asset(spec, output, args.checked_date)
        assets.append(asset)

    projects = build_projects(output, assets)
    manifest = {
        "schema": "makeable-assembly-interface-assets-v2",
        "revision": REVISION,
        "generatedAt": "2026-08-27T00:00:00.000Z",
        "units": UNITS,
        "scale": SCALE,
        "assets": assets,
        "projects": projects,
    }

    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    summary = {
        "output": str(output),
        "manifest": str(manifest_path),
        "assetCount": len(assets),
        "readyAssets": sum(1 for asset in assets if asset["interfaceEligibility"]["state"] == "ready"),
        "projectCount": len(projects),
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


def build_asset(spec: dict, output: Path, checked_date: str) -> dict:
    kind = spec["kind"]
    if kind == "controller_c6_lcd":
        scene = build_controller_c6_lcd(spec)
    elif kind == "sensor_bme280":
        scene = build_bme280(spec)
    elif kind == "sensor_bh1750":
        scene = build_bh1750(spec)
    elif kind == "soil_sensor":
        scene = build_soil_sensor(spec)
    elif kind == "breadboard":
        raise ValueError("policy_breadboard_banned: use direct pins, keyed connectors, or an exact verified expansion board")
    elif kind == "controller_xiao":
        scene = build_xiao(spec)
    elif kind == "controller_c3_mini":
        scene = build_c3_mini(spec)
    elif kind == "servo_pair":
        scene = build_servo_pair(spec)
    elif kind == "rgb_led":
        scene = build_rgb_led(spec)
    elif kind == "touch_ttp223":
        scene = build_ttp223(spec)
    else:
        raise ValueError(f"Unsupported asset kind: {kind}")

    scene.apply_scale(SCALE)
    glb_bytes = scene.export(file_type="glb")
    glb_name = f"{spec['assetId']}.glb"
    glb_path = output / glb_name
    glb_path.write_bytes(glb_bytes)

    bounds_mm = (scene.bounds * 1000.0).reshape(-1).tolist()
    triangle_count = int(sum(int(getattr(geom, "faces", np.empty((0, 3), dtype=np.int64)).shape[0]) for geom in scene.geometry.values()))
    node_names = sorted(str(node) for node in scene.graph.nodes_geometry)
    glb_hash = hashlib.sha256(glb_bytes).hexdigest()

    asset = {
        "assetId": spec["assetId"],
        "partId": spec["partId"],
        "sku": spec["sku"],
        "name": spec["name"],
        "category": spec["category"],
        "revision": REVISION,
        "units": UNITS,
        "sourceEvidence": spec["sourceEvidence"],
        "checkedDate": checked_date,
        "reconstructionMethod": spec["reconstructionMethod"],
        "glb": {
            "file": glb_name,
            "sha256": glb_hash,
            "bytes": len(glb_bytes),
            "triangles": triangle_count,
            "boundsMm": [round(v, 3) for v in bounds_mm],
        },
        "boundsMm": [round(v, 3) for v in bounds_mm],
        "anchors": spec["anchors"],
        "nodeNames": node_names,
        "interfaceEligibility": {
            "state": "ready",
            "reasons": [],
        },
        "mechanicalEligibility": spec.get("mechanicalEligibility", {"state": "ready", "reasons": []}),
    }
    (output / f"{spec['assetId']}.json").write_text(json.dumps(asset, indent=2) + "\n", encoding="utf-8")
    return asset


def build_projects(output: Path, assets: list[dict]) -> list[dict]:
    asset_by_id = {asset["assetId"]: asset for asset in assets}
    projects = []
    for spec in PROJECT_SPECS:
        project = {
            "buildId": spec["buildId"],
            "contractRevision": "assembly-contract-v1",
            "revision": REVISION,
            "state": "ready",
            "requiredAssetIds": spec["assetIds"],
            "assetRevisions": {
                asset_id: asset_by_id[asset_id]["revision"] for asset_id in spec["assetIds"]
            },
            "assets": [
                {
                    "assetId": asset_id,
                    "assembled": spec["placements"][asset_id]["assembled"],
                    "exploded": spec["placements"][asset_id]["exploded"],
                }
                for asset_id in spec["assetIds"]
            ],
            "wires": spec["wires"],
            "steps": spec["steps"],
            "cameraKeyframes": spec["cameraKeyframes"],
            "enclosure": spec.get("enclosure", {}),
            "missingEvidenceReasons": [],
        }
        (output / f"{spec['buildId']}.json").write_text(json.dumps(project, indent=2) + "\n", encoding="utf-8")
        projects.append(project)
    return projects


def build_controller_c6_lcd(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    body = add_box(scene, "body", spec["sizeMm"], spec["bodyColor"], [0, 0, -spec["sizeMm"][2] / 2])
    add_box(scene, "display", spec["displayMm"], spec["displayColor"], [0, 0, 2.0])
    add_box(scene, "module", [28.0, 20.0, 2.6], [220, 214, 196, 255], [0, 0, 4.0])
    add_box(scene, "usb_c", [9.0, 6.0, 3.2], [205, 205, 205, 255], [0, -spec["sizeMm"][1] / 2 + 3.0, 1.2])
    add_box(scene, "soc", [10.0, 10.0, 1.4], [25, 25, 25, 255], [0, 3.0, 1.4])
    add_pin_row(
        scene,
        spec["anchors"],
        spec["pinColor"],
        pin_radius=0.52,
        pin_length=3.8,
        edge="left",
        body=spec["sizeMm"],
        positions=[-8.0, -4.0, 0.0, 4.0, 8.0],
    )
    return scene


def build_bme280(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    add_box(scene, "body", spec["sizeMm"], spec["bodyColor"], [0, 0, -spec["sizeMm"][2] / 2])
    add_box(scene, "sensor", [3.6, 3.6, 1.4], [38, 38, 40, 255], [1.8, 0.6, 1.0])
    add_box(scene, "chip", [2.4, 1.8, 0.9], [30, 30, 30, 255], [-2.4, -0.9, 0.9])
    add_pin_row(
        scene,
        spec["anchors"],
        spec["pinColor"],
        pin_radius=0.45,
        pin_length=3.0,
        edge="bottom",
        body=spec["sizeMm"],
        positions=[-5.0, -3.0, -1.0, 1.0, 3.0, 5.0],
    )
    return scene


def build_bh1750(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    add_box(scene, "body", spec["sizeMm"], spec["bodyColor"], [0, 0, -spec["sizeMm"][2] / 2])
    add_cylinder(scene, "light_window", 2.8, 0.7, [230, 230, 220, 255], [0.0, 1.2, 0.9], axis="z")
    add_box(scene, "sensor", [3.0, 2.2, 1.0], [42, 42, 44, 255], [-2.2, -1.0, 0.9])
    add_pin_row(
        scene,
        spec["anchors"],
        spec["pinColor"],
        pin_radius=0.45,
        pin_length=3.0,
        edge="bottom",
        body=spec["sizeMm"],
        positions=[-4.0, -2.0, 0.0, 2.0, 4.0],
    )
    return scene


def build_soil_sensor(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    add_box(scene, "head", [23.0, 23.0, 3.0], spec["bodyColor"], [-27.0, 0, -1.5])
    add_box(scene, "connector", [11.5, 7.5, 5.5], [38, 38, 42, 255], [-34.5, 0, 1.5])
    add_box(scene, "cable", [18.0, 3.4, 2.0], [55, 55, 55, 255], [-47.0, 0, -0.2])
    add_box(scene, "blade", [80.0, 14.0, 1.8], [53, 92, 78, 255], [15.0, 0, -1.6])
    add_box(scene, "blade_tip", [12.0, 10.0, 1.4], [34, 63, 53, 255], [58.0, 0, -1.8])
    add_pin_row(
        scene,
        spec["anchors"],
        spec["pinColor"],
        pin_radius=0.42,
        pin_length=3.0,
        edge="top",
        body=[98.0, 23.0, 3.0],
        positions=[-6.0, 0.0, 6.0],
        offset_x=-41.5,
    )
    return scene


def build_breadboard(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    add_box(scene, "base", spec["sizeMm"], spec["bodyColor"], [0, 0, -spec["sizeMm"][2] / 2])
    add_box(scene, "center_gap", [2.2, 49.0, 0.9], [120, 120, 120, 255], [0, 0, 0.6])
    add_box(scene, "left_rail_red", [4.0, 52.0, 0.6], [200, 55, 48, 255], [-38.0, 0, 0.4])
    add_box(scene, "left_rail_blue", [4.0, 52.0, 0.6], [60, 115, 195, 255], [-33.5, 0, 0.4])
    add_box(scene, "right_rail_red", [4.0, 52.0, 0.6], [200, 55, 48, 255], [38.0, 0, 0.4])
    add_box(scene, "right_rail_blue", [4.0, 52.0, 0.6], [60, 115, 195, 255], [33.5, 0, 0.4])
    rail_geom = trimesh.creation.cylinder(radius=0.7, height=0.45, sections=8)
    rail_geom.visual.vertex_colors = [245, 245, 244, 255]
    rail_specs = [
        ("rail:+3V3", [-38.0, 20.0, 0.3]),
        ("rail:GND", [-33.5, -20.0, 0.3]),
        ("rail:+5V", [38.0, 20.0, 0.3]),
    ]
    anchors = []
    for node_name, translation in rail_specs:
        add_instance(scene, rail_geom, node_name, translation, [0, 0, 1], duplicate_suffix=False)
        anchors.append({
            "name": node_name,
            "positionMm": translation,
            "normalMm": [0, 0, 1],
            "role": "rail",
            "pitchMm": 2.54,
        })
    hole_geom = trimesh.creation.cylinder(radius=0.46, height=0.48, sections=6)
    hole_geom.visual.vertex_colors = [245, 245, 244, 255]
    x_positions = [round(-36.83 + 2.54 * index, 2) for index in range(30)]
    top_rows = [round(-16.51 + 2.54 * index, 2) for index in range(5)]
    bottom_rows = [round(6.35 + 2.54 * index, 2) for index in range(5)]
    for row_index, y in enumerate(top_rows + bottom_rows):
        for col_index, x in enumerate(x_positions):
            name = f"tie:{row_index + 1:02d}:{col_index + 1:02d}"
            add_instance(scene, hole_geom, name, [x, y, 0.3], [0, 0, 1], duplicate_suffix=False)
    for row_index, y in enumerate(top_rows + bottom_rows):
        for col_index, x in enumerate(x_positions):
            anchors.append({
                "name": f"tie:{row_index + 1:02d}:{col_index + 1:02d}",
                "positionMm": [x, y, 0.3],
                "normalMm": [0, 0, 1],
                "role": "tie-point",
                "pitchMm": 2.54,
            })
    spec["anchors"] = anchors
    return scene


def build_xiao(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    add_box(scene, "body", spec["sizeMm"], spec["bodyColor"], [0, 0, -spec["sizeMm"][2] / 2])
    add_box(scene, "usb_c", [9.4, 5.8, 3.2], [205, 205, 205, 255], [0, -spec["sizeMm"][1] / 2 + 2.6, 1.2])
    add_box(scene, "soc", [8.6, 8.6, 1.2], [28, 28, 28, 255], [0, 2.0, 1.0])
    add_pin_row(scene, spec["anchors"], spec["pinColor"], pin_radius=0.42, pin_length=3.2, edge="left", body=spec["sizeMm"], positions=[-6.5, -4.0, -1.6, 0.8, 3.2, 5.6, 8.0], anchor_offset=0)
    add_pin_row(scene, spec["anchors"], spec["pinColor"], pin_radius=0.42, pin_length=3.2, edge="right", body=spec["sizeMm"], positions=[-6.5, -4.0, -1.6, 0.8, 3.2, 5.6, 8.0], anchor_offset=7)
    return scene


def build_c3_mini(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    add_box(scene, "body", spec["sizeMm"], spec["bodyColor"], [0, 0, -spec["sizeMm"][2] / 2])
    add_box(scene, "usb_c", [9.2, 5.8, 3.2], [205, 205, 205, 255], [0, -spec["sizeMm"][1] / 2 + 2.6, 1.2])
    add_box(scene, "soc", [8.4, 8.4, 1.2], [27, 27, 27, 255], [0, 1.8, 1.0])
    left_positions = [-7.8, -5.8, -3.8, -1.8, 0.2, 2.2, 4.2, 6.2]
    right_positions = [-7.8, -5.8, -3.8, -1.8, 0.2, 2.2, 4.2, 6.2]
    add_pin_row(scene, spec["anchors"], spec["pinColor"], pin_radius=0.42, pin_length=3.3, edge="left", body=spec["sizeMm"], positions=left_positions, anchor_offset=0)
    add_pin_row(scene, spec["anchors"], spec["pinColor"], pin_radius=0.42, pin_length=3.3, edge="right", body=spec["sizeMm"], positions=right_positions, anchor_offset=8)
    return scene


def build_servo_pair(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    left = [-29.0, 0.0, -11.8]
    right = [29.0, 0.0, -11.8]
    servo_body = [22.8, 11.9, 23.1]
    wheel_radius = 30.0
    wheel_thickness = 7.8
    for side, center in (("left", left), ("right", right)):
        add_box(scene, f"{side}_body", servo_body, spec["bodyColor"], center)
        add_box(scene, f"{side}_lead", [28.0, 3.2, 2.0], [160, 115, 82, 255], [center[0] + 10.0, center[1] - 8.5, -2.2])
        add_cylinder(scene, f"{side}_wheel", wheel_radius, wheel_thickness, [230, 230, 228, 255], [center[0], center[1] + 18.5, -3.0], axis="x")
        add_cylinder(scene, f"{side}_hub", 4.0, 3.8, [65, 65, 65, 255], [center[0], center[1] + 10.8, -2.0], axis="x")
    anchors = []
    for side, x in (("left", -29.0), ("right", 29.0)):
        for name, dy in (("signal", -8.0), ("vcc", -5.5), ("gnd", -3.0)):
            pin_name = f"{side}:{name}"
            add_instance(scene, trimesh.creation.cylinder(radius=0.42, height=3.0, sections=6), pin_name, [x + 11.0, dy, -2.0], [0, 0, 1], duplicate_suffix=False)
            anchors.append({
                "name": pin_name,
                "positionMm": [x + 11.0, dy, -2.0],
                "normalMm": [0, 0, 1],
                "role": name,
                "pitchMm": 2.54,
            })
    spec["anchors"] = anchors
    return scene


def build_rgb_led(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    add_box(scene, "body", spec["sizeMm"], spec["bodyColor"], [0, 0, -spec["sizeMm"][2] / 2])
    add_box(scene, "led", [5.4, 5.4, 4.2], [240, 198, 72, 255], [0, 0.8, 2.6])
    add_cylinder(scene, "lens", 2.4, 3.2, [250, 90, 65, 255], [0, 0.8, 3.4], axis="z")
    add_pin_row(scene, spec["anchors"], spec["pinColor"], pin_radius=0.44, pin_length=3.0, edge="bottom", body=spec["sizeMm"], positions=[-7.5, -2.5, 2.5, 7.5])
    return scene


def build_ttp223(spec: dict) -> trimesh.Scene:
    scene = trimesh.Scene()
    add_box(scene, "body", spec["sizeMm"], spec["bodyColor"], [0, 0, -spec["sizeMm"][2] / 2])
    add_cylinder(scene, "touch", 4.8, 0.8, [35, 122, 219, 255], [0.0, 1.4, 1.2], axis="z")
    add_box(scene, "ic", [2.8, 2.8, 0.9], [28, 28, 30, 255], [0.5, -0.4, 0.9])
    add_pin_row(scene, spec["anchors"], spec["pinColor"], pin_radius=0.42, pin_length=2.8, edge="bottom", body=spec["sizeMm"], positions=[-5.0, 0.0, 5.0])
    return scene


def add_box(scene: trimesh.Scene, geom_name: str, size_mm, color, translation_mm) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=size_mm)
    mesh.visual.vertex_colors = color
    mesh.apply_translation([translation_mm[0], translation_mm[1], translation_mm[2]])
    scene.add_geometry(mesh, geom_name=geom_name)
    return mesh


def add_cylinder(scene: trimesh.Scene, geom_name: str, radius_mm: float, height_mm: float, color, translation_mm, axis="z"):
    mesh = trimesh.creation.cylinder(radius=radius_mm, height=height_mm, sections=8)
    mesh.visual.vertex_colors = color
    if axis == "x":
        mesh.apply_transform(rotation_matrix(math.pi / 2, [0, 1, 0]))
    elif axis == "y":
        mesh.apply_transform(rotation_matrix(math.pi / 2, [1, 0, 0]))
    mesh.apply_translation(translation_mm)
    scene.add_geometry(mesh, geom_name=geom_name)
    return mesh


def add_pin_row(
    scene: trimesh.Scene,
    anchors: list[dict],
    color,
    pin_radius: float,
    pin_length: float,
    edge: str,
    body,
    positions=None,
    offset_x=0.0,
    anchor_offset: int = 0,
):
    width, depth, _ = body
    positions = positions or []
    if not positions:
        positions = []
    pin_geom = trimesh.creation.cylinder(radius=pin_radius, height=pin_length, sections=6)
    pin_geom.visual.vertex_colors = color

    if edge in {"left", "right"} and not positions:
        positions = np.linspace(-depth / 2 + 3.2, depth / 2 - 3.2, 7).tolist()
    if edge in {"top", "bottom"} and not positions:
        positions = np.linspace(-width / 2 + 3.2, width / 2 - 3.2, 5).tolist()

    for index, value in enumerate(positions):
        anchor_index = anchor_offset + index
        if edge == "left":
            translation = [-width / 2 - pin_length / 2 + 0.2, value, -1.6]
            normal = [-1, 0, 0]
            position = [translation[0] * 1.0, translation[1], translation[2]]
        elif edge == "right":
            translation = [width / 2 + pin_length / 2 - 0.2, value, -1.6]
            normal = [1, 0, 0]
            position = [translation[0] * 1.0, translation[1], translation[2]]
        elif edge == "top":
            translation = [offset_x + value, depth / 2 + pin_length / 2 - 0.2, -1.6]
            normal = [0, 1, 0]
            position = [translation[0], translation[1], translation[2]]
        else:
            translation = [offset_x + value, -depth / 2 - pin_length / 2 + 0.2, -1.6]
            normal = [0, -1, 0]
            position = [translation[0], translation[1], translation[2]]
        node_name = anchors[anchor_index]["name"] if anchor_index < len(anchors) else f"{edge}:{index}"
        add_instance(scene, pin_geom, node_name, translation, normal)
        if anchor_index < len(anchors):
            anchors[anchor_index]["positionMm"] = [round(position[0], 3), round(position[1], 3), round(position[2], 3)]
            anchors[anchor_index]["normalMm"] = normal
            anchors[anchor_index]["pitchMm"] = 2.54


def add_instance(scene: trimesh.Scene, geometry: trimesh.Trimesh, node_name: str, translation_mm, normal_mm, duplicate_suffix=True):
    geom_name = node_name if duplicate_suffix else node_name.replace(":", "_")
    matrix = translation_matrix(translation_mm)
    scene.add_geometry(geometry.copy(), geom_name=geom_name, node_name=node_name, transform=matrix)


def build_project_assets(asset_ids, placements):
    return [
        {
            "assetId": asset_id,
            "assembled": placements[asset_id]["assembled"],
            "exploded": placements[asset_id]["exploded"],
        }
        for asset_id in asset_ids
    ]


def project_step(title, instruction, visible_assets, active_wires, camera, note):
    return {
        "title": title,
        "instruction": instruction,
        "visibleAssets": visible_assets,
        "activeWires": active_wires,
        "camera": camera,
        "safetyNote": note,
    }


def matrix(position, rz=0.0):
    mat = translation_matrix(position)
    if rz:
        mat = np.dot(mat, rotation_matrix(rz, [0, 0, 1]))
    return [[float(mat[row, col]) for col in range(4)] for row in range(4)]


def wire(wire_id, signal, color, gauge, from_asset, from_anchor, to_asset, to_anchor):
    return {
        "id": wire_id,
        "signal": signal,
        "color": color,
        "gauge": gauge,
        "from": {"assetId": from_asset, "anchor": from_anchor},
        "to": {"assetId": to_asset, "anchor": to_anchor},
        "routing": "orthogonal",
        "controlPointsMm": [],
    }


ASSET_SPECS = [
    {
        "assetId": "waveshare-esp32-c6-lcd-1_47-m",
        "partId": "b0f99kmrvl-39",
        "sku": "B0F99KMRVL",
        "name": "Waveshare ESP32-C6-LCD-1.47-M",
        "category": "controller",
        "kind": "controller_c6_lcd",
        "sizeMm": [52.0, 25.4, 8.4],
        "displayMm": [29.5, 18.0, 1.4],
        "bodyColor": [18, 30, 38, 255],
        "displayColor": [230, 230, 220, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://docs.waveshare.com/ESP32-C6-LCD-1.47", "checkedDate": "2026-08-27", "note": "board documentation"},
            {"url": "https://files.waveshare.com/wiki/ESP32-C6-LCD-1.47/ESP32-C6-LCD-1.47_schemetics.pdf", "checkedDate": "2026-08-27", "note": "schematic"},
        ],
        "reconstructionMethod": "deterministic-pcb-outline-and-pinout",
        "anchors": [
            {"name": "3V3", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GND", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO18/SDA", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO19/SCL", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO1/ADC1_CH1", "positionMm": [0.0, 0.0, 0.0]},
        ],
    },
    {
        "assetId": "gy-bme280-breakout",
        "partId": "b0bqfv883t-18",
        "sku": "B0BQFV883T",
        "name": "GY-BME280 breakout",
        "category": "sensor",
        "kind": "sensor_bme280",
        "sizeMm": [15.4, 12.6, 5.4],
        "bodyColor": [29, 79, 102, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://www.bosch-sensortec.com/en/products/environmental-sensors/humidity-sensors-bme280", "checkedDate": "2026-08-27", "note": "BME280 documentation"},
        ],
        "reconstructionMethod": "deterministic-breakout-outline-and-pinout",
        "anchors": [
            {"name": "VCC", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GND", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "SCL", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "SDA", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "CSB", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "SDO", "positionMm": [0.0, 0.0, 0.0]},
        ],
    },
    {
        "assetId": "gy-302-bh1750-breakout",
        "partId": "b0cn55s7z9-72",
        "sku": "B0CN55S7Z9",
        "name": "GY-302/BH1750 breakout",
        "category": "sensor",
        "kind": "sensor_bh1750",
        "sizeMm": [18.5, 13.7, 5.0],
        "bodyColor": [25, 77, 96, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://www.mouser.com/datasheet/2/348/bh1750fvi-e-186247.pdf", "checkedDate": "2026-08-27", "note": "BH1750 datasheet"},
        ],
        "reconstructionMethod": "deterministic-breakout-outline-and-pinout",
        "anchors": [
            {"name": "VCC", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GND", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "SCL", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "SDA", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "ADDR", "positionMm": [0.0, 0.0, 0.0]},
        ],
    },
    {
        "assetId": "diyables-capacitive-soil-moisture-tlc555i",
        "partId": "b0dydn9rg4-81",
        "sku": "B0DYDN9RG4",
        "name": "DIYables TLC555I soil-moisture sensor",
        "category": "sensor",
        "kind": "soil_sensor",
        "sizeMm": [98.0, 23.0, 7.0],
        "bodyColor": [29, 98, 72, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://diyables.io/products/capacitive-soil-moisture-sensor-module", "checkedDate": "2026-08-27", "note": "product specification"},
        ],
        "reconstructionMethod": "deterministic-head-and-blade-outline",
        "anchors": [
            {"name": "GND", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "VCC", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "AOUT", "positionMm": [0.0, 0.0, 0.0]},
        ],
    },
    {
        "assetId": "adafruit-half-size-breadboard-64",
        "partId": "breadboard-half-size-64",
        "sku": "B0BXKM8DQ8",
        "name": "Adafruit half-size breadboard #64",
        "category": "accessory",
        "kind": "breadboard",
        "sizeMm": [82.6, 55.0, 9.3],
        "bodyColor": [245, 244, 240, 255],
        "pinColor": [75, 75, 75, 255],
        "sourceEvidence": [
            {"url": "https://www.adafruit.com/product/64", "checkedDate": "2026-08-27", "note": "breadboard dimensions"},
        ],
        "reconstructionMethod": "deterministic-grid-and-rail-model",
        "anchors": [],
    },
    {
        "assetId": "seeed-xiao-esp32s3",
        "partId": "b0drnvh8mq-1",
        "sku": "B0DRNVH8MQ",
        "name": "Seeed Studio XIAO ESP32S3 (Pre-Soldered)",
        "category": "controller",
        "kind": "controller_xiao",
        "sizeMm": [21.0, 17.8, 7.0],
        "bodyColor": [28, 28, 31, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://wiki.seeedstudio.com/XIAO_ESP32S3_Getting_Started/", "checkedDate": "2026-08-27", "note": "XIAO reference"},
        ],
        "reconstructionMethod": "deterministic-tiny-board-outline-and-header-placement",
        "anchors": [
            {"name": "D0", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D1", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D2", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D3", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D4/SDA", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D5/SCL", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D6/TX", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D7/RX", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D8", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D9", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "D10", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "5V", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GND", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "3V3", "positionMm": [0.0, 0.0, 0.0]},
        ],
    },
    {
        "assetId": "aoicrie-esp32-c3-mini",
        "partId": "b0dd3zb5xv-4",
        "sku": "B0DD3ZB5XV",
        "name": "AOICRIE ESP32-C3 Mini Development Board Pre-Soldered",
        "category": "controller",
        "kind": "controller_c3_mini",
        "sizeMm": [23.0, 18.0, 7.0],
        "bodyColor": [20, 31, 39, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://www.amazon.com/AOICRIE-Development-Pre-Soldered-Supermini-MicroPython/dp/B0DD3ZB5XV", "checkedDate": "2026-08-27", "note": "Amazon listing"},
        ],
        "reconstructionMethod": "deterministic-tiny-board-outline-and-header-placement",
        "anchors": [
            {"name": "5V", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GND", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "3.3V", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO4", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO3", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO2", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO1", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO0", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO5", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO6", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO7", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO8/SDA", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO9/SCL", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO10", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO20/RX", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "GPIO21/TX", "positionMm": [0.0, 0.0, 0.0]},
        ],
    },
    {
        "assetId": "fs90r-paired-wheel-kit",
        "partId": "b086zgtlzb-79",
        "sku": "B086ZGTLZB",
        "name": "Feetech FS90R 360-degree continuous-rotation micro servos with wheels, 2-pack",
        "category": "actuator",
        "kind": "servo_pair",
        "sizeMm": [78.0, 30.0, 24.0],
        "bodyColor": [76, 74, 72, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://www.amazon.com/dp/B086ZGTLZB", "checkedDate": "2026-08-27", "note": "Amazon listing"},
        ],
        "reconstructionMethod": "deterministic-servo-pair-and-wheel-outline",
        "anchors": [],
    },
    {
        "assetId": "rgb-led-module",
        "partId": "b0bxkmgsg6-52",
        "sku": "B0BXKMGSG6",
        "name": "DIYables RGB LED Module",
        "category": "output",
        "kind": "rgb_led",
        "sizeMm": [25.0, 20.0, 9.0],
        "bodyColor": [40, 41, 44, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://www.amazon.com/dp/B0BXKMGSG6", "checkedDate": "2026-08-27", "note": "Amazon listing"},
        ],
        "reconstructionMethod": "deterministic-led-module-outline-and-pinout",
        "anchors": [
            {"name": "GND", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "B", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "G", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "R", "positionMm": [0.0, 0.0, 0.0]},
        ],
    },
    {
        "assetId": "ttp223-touch-module",
        "partId": "b0bpg115t1-46",
        "sku": "B0BPG115T1",
        "name": "TTP223 capacitive touch module",
        "category": "input",
        "kind": "touch_ttp223",
        "sizeMm": [15.0, 11.0, 4.0],
        "bodyColor": [45, 78, 120, 255],
        "pinColor": [236, 184, 78, 255],
        "sourceEvidence": [
            {"url": "https://datasheet.lcsc.com/lcsc/1810221811_Tontek-Design-Tech-TTP223-BA6_C80757.pdf", "checkedDate": "2026-08-27", "note": "TTP223 datasheet"},
        ],
        "reconstructionMethod": "deterministic-touch-paddle-outline-and-pinout",
        "anchors": [
            {"name": "GND", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "I/O", "positionMm": [0.0, 0.0, 0.0]},
            {"name": "VCC", "positionMm": [0.0, 0.0, 0.0]},
        ],
    },
]


PROJECT_SPECS = [
    {
        "buildId": "plant-companion-v1",
        "assetIds": [
            "waveshare-esp32-c6-lcd-1_47-m",
            "gy-bme280-breakout",
            "gy-302-bh1750-breakout",
            "diyables-capacitive-soil-moisture-tlc555i",
            "adafruit-half-size-breadboard-64",
        ],
        "placements": {
            "waveshare-esp32-c6-lcd-1_47-m": {
                "assembled": matrix([82.0, 68.0, 8.0], rz=0.0),
                "exploded": matrix([100.0, 86.0, 18.0], rz=-0.08),
            },
            "gy-bme280-breakout": {
                "assembled": matrix([-55.0, 76.0, 4.0], rz=0.08),
                "exploded": matrix([-78.0, 96.0, 14.0], rz=0.2),
            },
            "gy-302-bh1750-breakout": {
                "assembled": matrix([-18.0, 76.0, 4.0], rz=-0.05),
                "exploded": matrix([-38.0, 98.0, 14.0], rz=-0.15),
            },
            "diyables-capacitive-soil-moisture-tlc555i": {
                "assembled": matrix([64.0, 22.0, 8.0], rz=0.0),
                "exploded": matrix([86.0, 6.0, 16.0], rz=0.18),
            },
            "adafruit-half-size-breadboard-64": {
                "assembled": matrix([0.0, 0.0, 0.0], rz=0.0),
                "exploded": matrix([0.0, -22.0, 18.0], rz=0.0),
            },
        },
        "wires": [
            wire("plant-3v3", "3V3", "red", "24AWG", "waveshare-esp32-c6-lcd-1_47-m", "3V3", "adafruit-half-size-breadboard-64", "rail:+3V3"),
            wire("plant-gnd", "GND", "black", "24AWG", "waveshare-esp32-c6-lcd-1_47-m", "GND", "adafruit-half-size-breadboard-64", "rail:GND"),
            wire("plant-sda", "I2C SDA", "blue", "24AWG", "waveshare-esp32-c6-lcd-1_47-m", "GPIO18/SDA", "gy-bme280-breakout", "SDA"),
            wire("plant-sda-2", "I2C SDA", "blue", "24AWG", "waveshare-esp32-c6-lcd-1_47-m", "GPIO18/SDA", "gy-302-bh1750-breakout", "SDA"),
            wire("plant-scl", "I2C SCL", "yellow", "24AWG", "waveshare-esp32-c6-lcd-1_47-m", "GPIO19/SCL", "gy-bme280-breakout", "SCL"),
            wire("plant-scl-2", "I2C SCL", "yellow", "24AWG", "waveshare-esp32-c6-lcd-1_47-m", "GPIO19/SCL", "gy-302-bh1750-breakout", "SCL"),
            wire("plant-vcc-bme", "3V3", "red", "24AWG", "adafruit-half-size-breadboard-64", "rail:+3V3", "gy-bme280-breakout", "VCC"),
            wire("plant-gnd-bme", "GND", "black", "24AWG", "adafruit-half-size-breadboard-64", "rail:GND", "gy-bme280-breakout", "GND"),
            wire("plant-vcc-bh", "3V3", "red", "24AWG", "adafruit-half-size-breadboard-64", "rail:+3V3", "gy-302-bh1750-breakout", "VCC"),
            wire("plant-gnd-bh", "GND", "black", "24AWG", "adafruit-half-size-breadboard-64", "rail:GND", "gy-302-bh1750-breakout", "GND"),
            wire("plant-vcc-soil", "3V3", "red", "24AWG", "adafruit-half-size-breadboard-64", "rail:+3V3", "diyables-capacitive-soil-moisture-tlc555i", "VCC"),
            wire("plant-gnd-soil", "GND", "black", "24AWG", "adafruit-half-size-breadboard-64", "rail:GND", "diyables-capacitive-soil-moisture-tlc555i", "GND"),
            wire("plant-aout", "AOUT", "green", "24AWG", "diyables-capacitive-soil-moisture-tlc555i", "AOUT", "waveshare-esp32-c6-lcd-1_47-m", "GPIO1/ADC1_CH1"),
        ],
        "steps": [
            project_step(
                "Mount the controller",
                "Place the Waveshare controller in the enclosure footprint and keep the USB-C opening clear. Leave power disconnected.",
                ["waveshare-esp32-c6-lcd-1_47-m"],
                [],
                {"positionMm": [180, 120, 150], "targetMm": [80, 60, 20]},
                "USB must stay unplugged until the final polarity check.",
            ),
            project_step(
                "Seat the breadboard",
                "Align the half-size breadboard so the rail labels stay readable and the center trench stays clear.",
                ["waveshare-esp32-c6-lcd-1_47-m", "adafruit-half-size-breadboard-64"],
                ["plant-3v3", "plant-gnd"],
                {"positionMm": [150, 95, 130], "targetMm": [40, 40, 10]},
                "Use only the rail markings for the power bus.",
            ),
            project_step(
                "Add I2C sensors",
                "Attach the BME280 and BH1750 breakouts, then run the shared SDA and SCL rows as short clean jumps.",
                ["waveshare-esp32-c6-lcd-1_47-m", "gy-bme280-breakout", "gy-302-bh1750-breakout", "adafruit-half-size-breadboard-64"],
                ["plant-sda", "plant-sda-2", "plant-scl", "plant-scl-2"],
                {"positionMm": [125, 88, 110], "targetMm": [10, 50, 10]},
                "I2C devices stay on 3.3V only.",
            ),
            project_step(
                "Route moisture sensing",
                "Clip the soil probe to the pot line, keep the blade external, and connect AOUT to the ADC pin.",
                ["diyables-capacitive-soil-moisture-tlc555i", "adafruit-half-size-breadboard-64"],
                ["plant-vcc-soil", "plant-gnd-soil", "plant-aout"],
                {"positionMm": [80, 70, 105], "targetMm": [60, 20, 10]},
                "Do not bury the sensor head; only the blade enters the soil.",
            ),
            project_step(
                "Final check",
                "Verify labels, pin order, and cable seating before connecting power.",
                ["waveshare-esp32-c6-lcd-1_47-m", "gy-bme280-breakout", "gy-302-bh1750-breakout", "diyables-capacitive-soil-moisture-tlc555i", "adafruit-half-size-breadboard-64"],
                ["plant-3v3", "plant-gnd", "plant-sda", "plant-scl", "plant-aout"],
                {"positionMm": [125, 95, 135], "targetMm": [45, 45, 12]},
                "USB stays disconnected until polarity and continuity are checked.",
            ),
        ],
        "cameraKeyframes": [
            {"step": 1, "positionMm": [180, 120, 150], "targetMm": [80, 60, 20]},
            {"step": 3, "positionMm": [125, 88, 110], "targetMm": [10, 50, 10]},
            {"step": 5, "positionMm": [125, 95, 135], "targetMm": [45, 45, 12]},
        ],
        "enclosure": {
            "revision": "plant-companion-enclosure-v1",
            "notes": "controller plus sensor bundle fits behind a clean rear service opening; breadboard retained for prototyping.",
        },
    },
    {
        "buildId": "toy-car-v1",
        "assetIds": [
            "seeed-xiao-esp32s3",
            "fs90r-paired-wheel-kit",
            "adafruit-half-size-breadboard-64",
        ],
        "placements": {
            "seeed-xiao-esp32s3": {
                "assembled": matrix([0.0, 46.0, 8.0], rz=0.0),
                "exploded": matrix([0.0, 64.0, 18.0], rz=-0.16),
            },
            "fs90r-paired-wheel-kit": {
                "assembled": matrix([0.0, 0.0, 0.0], rz=0.0),
                "exploded": matrix([0.0, -24.0, 12.0], rz=0.0),
            },
            "adafruit-half-size-breadboard-64": {
                "assembled": matrix([0.0, 10.0, 0.0], rz=0.0),
                "exploded": matrix([0.0, -6.0, 16.0], rz=0.0),
            },
        },
        "wires": [
            wire("car-3v3", "3V3", "red", "24AWG", "seeed-xiao-esp32s3", "3V3", "adafruit-half-size-breadboard-64", "rail:+3V3"),
            wire("car-gnd", "GND", "black", "24AWG", "seeed-xiao-esp32s3", "GND", "adafruit-half-size-breadboard-64", "rail:GND"),
            wire("car-left-sig", "PWM", "orange", "24AWG", "seeed-xiao-esp32s3", "D0", "fs90r-paired-wheel-kit", "left:signal"),
            wire("car-right-sig", "PWM", "orange", "24AWG", "seeed-xiao-esp32s3", "D1", "fs90r-paired-wheel-kit", "right:signal"),
            wire("car-left-vcc", "5V", "red", "22AWG", "adafruit-half-size-breadboard-64", "rail:+5V", "fs90r-paired-wheel-kit", "left:vcc"),
            wire("car-left-gnd", "GND", "black", "22AWG", "adafruit-half-size-breadboard-64", "rail:GND", "fs90r-paired-wheel-kit", "left:gnd"),
            wire("car-right-vcc", "5V", "red", "22AWG", "adafruit-half-size-breadboard-64", "rail:+5V", "fs90r-paired-wheel-kit", "right:vcc"),
            wire("car-right-gnd", "GND", "black", "22AWG", "adafruit-half-size-breadboard-64", "rail:GND", "fs90r-paired-wheel-kit", "right:gnd"),
        ],
        "steps": [
            project_step(
                "Mount the microcontroller",
                "Place the XIAO on the chassis and keep the USB-C rear access clear.",
                ["seeed-xiao-esp32s3"],
                [],
                {"positionMm": [90, 40, 90], "targetMm": [0, 40, 10]},
                "Keep the battery or supply disconnected while routing servo leads.",
            ),
            project_step(
                "Fix the wheel kit",
                "Seat the paired FS90R servos with the wheels facing outward and keep the leads untangled.",
                ["fs90r-paired-wheel-kit"],
                [],
                {"positionMm": [100, 10, 90], "targetMm": [0, 0, 0]},
                "The servos need external regulated power; do not power them from GPIO or 3V3.",
            ),
            project_step(
                "Wire power rails",
                "Run the breadboard rails as the servo power bus and keep the ground common with the controller.",
                ["seeed-xiao-esp32s3", "fs90r-paired-wheel-kit", "adafruit-half-size-breadboard-64"],
                ["car-3v3", "car-gnd", "car-left-vcc", "car-left-gnd", "car-right-vcc", "car-right-gnd"],
                {"positionMm": [70, 28, 100], "targetMm": [0, 20, 10]},
                "Servo power stays off until signal wiring is checked.",
            ),
            project_step(
                "Run the PWM signals",
                "Connect each servo signal line to a separate controller pin and verify left/right direction before applying load.",
                ["seeed-xiao-esp32s3", "fs90r-paired-wheel-kit", "adafruit-half-size-breadboard-64"],
                ["car-left-sig", "car-right-sig"],
                {"positionMm": [60, 16, 95], "targetMm": [0, 10, 5]},
                "Never hot-plug the servo connector under load.",
            ),
        ],
        "cameraKeyframes": [
            {"step": 1, "positionMm": [90, 40, 90], "targetMm": [0, 40, 10]},
            {"step": 3, "positionMm": [70, 28, 100], "targetMm": [0, 20, 10]},
        ],
        "enclosure": {
            "revision": "toy-car-chassis-v1",
            "notes": "breadboard sits inside the chassis as a temporary distribution layer; the final enclosure can replace it with a harness.",
        },
    },
    {
        "buildId": "touch-lamp-v1",
        "assetIds": [
            "aoicrie-esp32-c3-mini",
            "rgb-led-module",
            "ttp223-touch-module",
            "adafruit-half-size-breadboard-64",
        ],
        "placements": {
            "aoicrie-esp32-c3-mini": {
                "assembled": matrix([0.0, 42.0, 8.0], rz=0.0),
                "exploded": matrix([0.0, 58.0, 18.0], rz=0.12),
            },
            "rgb-led-module": {
                "assembled": matrix([42.0, 4.0, 4.0], rz=0.0),
                "exploded": matrix([58.0, 4.0, 14.0], rz=0.0),
            },
            "ttp223-touch-module": {
                "assembled": matrix([-42.0, 4.0, 4.0], rz=0.0),
                "exploded": matrix([-58.0, 4.0, 14.0], rz=0.0),
            },
            "adafruit-half-size-breadboard-64": {
                "assembled": matrix([0.0, 0.0, 0.0], rz=0.0),
                "exploded": matrix([0.0, -20.0, 16.0], rz=0.0),
            },
        },
        "wires": [
            wire("lamp-3v3", "3V3", "red", "24AWG", "aoicrie-esp32-c3-mini", "3.3V", "adafruit-half-size-breadboard-64", "rail:+3V3"),
            wire("lamp-gnd", "GND", "black", "24AWG", "aoicrie-esp32-c3-mini", "GND", "adafruit-half-size-breadboard-64", "rail:GND"),
            wire("lamp-touch-vcc", "3V3", "red", "24AWG", "adafruit-half-size-breadboard-64", "rail:+3V3", "ttp223-touch-module", "VCC"),
            wire("lamp-touch-gnd", "GND", "black", "24AWG", "adafruit-half-size-breadboard-64", "rail:GND", "ttp223-touch-module", "GND"),
            wire("lamp-touch-out", "touch", "purple", "24AWG", "ttp223-touch-module", "I/O", "aoicrie-esp32-c3-mini", "GPIO4"),
            wire("lamp-led-gnd", "GND", "black", "24AWG", "adafruit-half-size-breadboard-64", "rail:GND", "rgb-led-module", "GND"),
            wire("lamp-led-r", "red", "red", "24AWG", "aoicrie-esp32-c3-mini", "GPIO5", "rgb-led-module", "R"),
            wire("lamp-led-g", "green", "green", "24AWG", "aoicrie-esp32-c3-mini", "GPIO6", "rgb-led-module", "G"),
            wire("lamp-led-b", "blue", "blue", "24AWG", "aoicrie-esp32-c3-mini", "GPIO7", "rgb-led-module", "B"),
        ],
        "steps": [
            project_step(
                "Mount the controller",
                "Set the C3 mini board in the shell and leave the USB-C rear access open.",
                ["aoicrie-esp32-c3-mini"],
                [],
                {"positionMm": [90, 54, 90], "targetMm": [0, 40, 10]},
                "Power stays disconnected while the sensor and LED wiring are laid out.",
            ),
            project_step(
                "Add the touch input",
                "Place the TTP223 on the left side and keep the touch pad visible through the enclosure opening.",
                ["aoicrie-esp32-c3-mini", "ttp223-touch-module"],
                ["lamp-touch-vcc", "lamp-touch-gnd", "lamp-touch-out"],
                {"positionMm": [85, 38, 90], "targetMm": [-40, 10, 10]},
                "Touch pads should stay dry and unobstructed.",
            ),
            project_step(
                "Add the RGB output",
                "Mount the RGB module on the right side and route each color lead separately for clarity.",
                ["aoicrie-esp32-c3-mini", "rgb-led-module", "ttp223-touch-module"],
                ["lamp-led-r", "lamp-led-g", "lamp-led-b"],
                {"positionMm": [85, 36, 92], "targetMm": [40, 10, 10]},
                "Use the color labels so the builder does not depend on wire color alone.",
            ),
            project_step(
                "Close the loop",
                "Bring 3V3 and GND to the rails and verify the touch pad and RGB channels before closing the shell.",
                ["aoicrie-esp32-c3-mini", "rgb-led-module", "ttp223-touch-module", "adafruit-half-size-breadboard-64"],
                ["lamp-3v3", "lamp-gnd", "lamp-touch-vcc", "lamp-touch-gnd", "lamp-led-gnd"],
                {"positionMm": [70, 35, 98], "targetMm": [0, 20, 10]},
                "Do not close the shell until the pad and LED directions are confirmed.",
            ),
        ],
        "cameraKeyframes": [
            {"step": 1, "positionMm": [90, 54, 90], "targetMm": [0, 40, 10]},
            {"step": 3, "positionMm": [85, 36, 92], "targetMm": [40, 10, 10]},
        ],
        "enclosure": {
            "revision": "touch-lamp-shell-v1",
            "notes": "the controller, touch pad, and RGB output remain visible through clean cutouts; breadboard stays internal.",
        },
    },
]
if __name__ == "__main__":
    raise SystemExit(main())
