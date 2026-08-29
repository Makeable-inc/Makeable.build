#!/usr/bin/env python3
"""Build the immutable rigid-interface and nominal-length asset for Adafruit #4397.

The runtime assembly re-routes only the flexible conductor segments. Connector
bodies, socket bodies, color order, named contacts, split point, and the exact
150 mm nominal cable-length contract come from this asset.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import trimesh


PART_ID = "adafruit-4397-qwiic-to-female-sockets"
REVISION = "adafruit-4397-interface-v1.1.0"
NOMINAL_LENGTH_MM = 150.0
COLORS = {
    "gnd": [24, 28, 32, 255],
    "3v3": [234, 78, 73, 255],
    "sda": [47, 151, 224, 255],
    "scl": [239, 194, 54, 255],
}
ORDER = [("gnd", 1.5), ("3v3", 0.5), ("sda", -0.5), ("scl", -1.5)]


def rgba(mesh: trimesh.Trimesh, color) -> trimesh.Trimesh:
    mesh.visual.vertex_colors = np.tile(np.array(color, dtype=np.uint8), (len(mesh.vertices), 1))
    return mesh


def box(size_mm, color) -> trimesh.Trimesh:
    return rgba(trimesh.creation.box(extents=np.array(size_mm, dtype=float) / 1000.0), color)


def cylinder_between(start_mm, end_mm, radius_mm, color) -> trimesh.Trimesh:
    start = np.array(start_mm, dtype=float) / 1000.0
    end = np.array(end_mm, dtype=float) / 1000.0
    vector = end - start
    length = float(np.linalg.norm(vector))
    mesh = trimesh.creation.cylinder(radius=radius_mm / 1000.0, height=length, sections=16)
    transform = trimesh.geometry.align_vectors([0, 0, 1], vector / length)
    transform[:3, 3] = (start + end) / 2.0
    mesh.apply_transform(transform)
    return rgba(mesh, color)


def add(scene: trimesh.Scene, name: str, mesh: trimesh.Trimesh, translation_mm=(0, 0, 0)) -> None:
    transform = np.eye(4)
    transform[:3, 3] = np.array(translation_mm, dtype=float) / 1000.0
    scene.add_geometry(mesh, node_name=name, geom_name=f"geometry:{name}", transform=transform)


def build_scene() -> trimesh.Scene:
    scene = trimesh.Scene(base_frame="adafruit-4397-origin")
    black = [32, 36, 40, 255]
    dark = [17, 20, 23, 255]
    metal = [184, 164, 116, 255]

    # JST-SH 1.0 mm four-pin plug. The insertion face is x=0 and its rear boot
    # points toward +X in the canonical asset frame.
    add(scene, "connector:qwiic-jst-sh-1.0mm-4p:plug-body", box([5.4, 6.0, 2.8], [232, 234, 230, 255]), [2.7, 0, 0])
    add(scene, "connector:qwiic-jst-sh-1.0mm-4p:key-ridge", box([2.4, 4.6, 0.55], [208, 212, 209, 255]), [1.8, 0, 1.675])
    add(scene, "connector:qwiic-jst-sh-1.0mm-4p:rear-boot", box([3.2, 5.4, 2.5], dark), [7.0, 0, 0])
    for index, (signal, y_mm) in enumerate(ORDER):
        add(scene, f"connector:qwiic:contact:{index}:{signal}", box([0.45, 0.32, 0.55], metal), [0.225, y_mm, 0])
        add(scene, f"anchor:qwiic:wire-exit:{signal}", box([0.08, 0.08, 0.08], COLORS[signal]), [8.6, y_mm, 0])

    split_x = 126.0
    add(scene, "cable:split-boot", box([7.0, 8.0, 3.2], black), [split_x, 0, 0])
    socket_y = {"gnd": 7.5, "3v3": 2.5, "sda": -2.5, "scl": -7.5}
    for signal, y_mm in ORDER:
        # Nominal straight conductor path is an evidence view only. Runtime
        # re-routes this flexible segment while retaining the 150 mm length.
        add(scene, f"cable:conductor:{signal}:main", cylinder_between([8.6, y_mm, 0], [split_x - 3.5, y_mm, 0], 0.62, COLORS[signal]))
        add(scene, f"cable:conductor:{signal}:branch", cylinder_between([split_x + 3.5, y_mm, 0], [138.0, socket_y[signal], 0], 0.62, COLORS[signal]))
        add(scene, f"connector:socket:{signal}:housing", box([12.0, 2.7, 2.7], black), [144.0, socket_y[signal], 0])
        add(scene, f"connector:socket:{signal}:metal-sleeve", box([7.0, 0.82, 0.82], metal), [146.5, socket_y[signal], 0])
        add(scene, f"connector:socket:{signal}:cavity", box([0.25, 0.72, 0.72], dark), [150.0, socket_y[signal], 0])
        add(scene, f"anchor:socket:{signal}:pin-entry", box([0.08, 0.08, 0.08], COLORS[signal]), [150.0, socket_y[signal], 0])
        add(scene, f"anchor:socket:{signal}:wire-exit", box([0.08, 0.08, 0.08], COLORS[signal]), [138.0, socket_y[signal], 0])
    add(scene, "anchor:cable:split", box([0.08, 0.08, 0.08], [255, 255, 255, 255]), [split_x, 0, 0])
    return scene


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def make_all_nodes_reachable(glb: bytes) -> bytes:
    """Attach every exported geometry node beneath one canonical scene root."""
    if glb[:4] != b"glTF" or int.from_bytes(glb[4:8], "little") != 2:
        raise RuntimeError("trimesh did not emit GLB 2.0")
    json_length = int.from_bytes(glb[12:16], "little")
    payload = json.loads(glb[20 : 20 + json_length].decode("utf-8"))
    existing = list(range(len(payload.get("nodes", []))))
    root_index = len(existing)
    payload.setdefault("nodes", []).append({"name": "root:adafruit-4397-cable", "children": existing})
    scene_index = int(payload.get("scene", 0))
    payload.setdefault("scenes", [{}])[scene_index]["nodes"] = [root_index]
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    remainder = glb[20 + json_length :]
    total_length = 12 + 8 + len(encoded) + len(remainder)
    return b"glTF" + (2).to_bytes(4, "little") + total_length.to_bytes(4, "little") + len(encoded).to_bytes(4, "little") + (0x4E4F534A).to_bytes(4, "little") + encoded + remainder


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: generate_adafruit_4397_cable_glb.py OUTPUT_ROOT")
    root = Path(sys.argv[1]).resolve()
    models = root / "models"
    reports = root / "reports"
    models.mkdir(parents=True, exist_ok=True)
    reports.mkdir(parents=True, exist_ok=True)
    target = models / f"{PART_ID}.glb"
    scene = build_scene()
    target.write_bytes(make_all_nodes_reachable(scene.export(file_type="glb")))
    bounds = scene.bounds * 1000.0
    node_names = sorted(str(name) for name in scene.graph.nodes_geometry)
    required = [
        "connector:qwiic-jst-sh-1.0mm-4p:plug-body",
        "connector:qwiic-jst-sh-1.0mm-4p:rear-boot",
        "anchor:cable:split",
        *[f"connector:qwiic:contact:{index}:{signal}" for index, (signal, _) in enumerate(ORDER)],
        *[f"connector:socket:{signal}:housing" for signal, _ in ORDER],
        *[f"anchor:socket:{signal}:pin-entry" for signal, _ in ORDER],
        *[f"anchor:socket:{signal}:wire-exit" for signal, _ in ORDER],
    ]
    missing = sorted(set(required) - set(node_names))
    if missing:
        raise RuntimeError(f"missing nodes: {missing}")
    manifest = {
        "schemaVersion": "MakeableCableInterfaceAssetV1",
        "partId": PART_ID,
        "name": "Adafruit STEMMA QT / Qwiic cable to premium female sockets #4397",
        "revision": REVISION,
        "catalogKey": "B09WLRBKWT",
        "manufacturerSku": "4397",
        "manufacturerUrl": "https://www.adafruit.com/product/4397",
        "nominalLengthMm": NOMINAL_LENGTH_MM,
        "connectorFamily": "jst_sh_1.0mm_4p_qwiic",
        "controllerTermination": "four_individual_factory_housed_female_sockets",
        "colorOrder": [signal for signal, _ in ORDER],
        "flexGeometryMode": "deterministic_runtime_harness_from_locked_anchors",
        "glb": {
            "path": str(target.relative_to(root)),
            "sha256": sha256(target),
            "bytes": target.stat().st_size,
            "boundsMm": [*bounds[0].round(4).tolist(), *bounds[1].round(4).tolist()],
        },
        "requiredNodes": required,
        "nodeCount": len(node_names),
        "sceneRoot": "root:adafruit-4397-cable",
        "sceneReachabilityRequired": True,
        "visualEligibility": "candidate_review",
        "interfaceEligibility": "ready",
        "selectionStatus": "candidate_review",
        "runtimeVisualPasses": 0,
    }
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (reports / "delivery-validation.json").write_text(json.dumps({
        "state": "pass",
        "glbSha256": manifest["glb"]["sha256"],
        "requiredNodesPresent": True,
        "nominalLengthMm": NOMINAL_LENGTH_MM,
        "runtimeVisualPasses": 0,
    }, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
