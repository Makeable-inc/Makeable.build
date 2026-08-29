#!/usr/bin/env python3
"""Generate the XIAO + SCD-41 enclosure from the shared product-design contract.

The printable STL coordinates are millimetres. The companion GLB is scaled to
metres, matching the Three.js assembly viewer and the AWS electronics assets.
No external CAD boolean backend is required: each solid is produced from a
deterministic 0.2 mm occupancy field and converted to a closed boundary mesh.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import trimesh


ROOT = Path(__file__).resolve().parents[2]
DESIGN_PATH = ROOT / "config" / "xiao-qwiic-product-design.json"
DEFAULT_OUTPUT = ROOT / "artifacts" / "xiao-qwiic-co2-enclosure"
RESOLUTION_MM = 0.5


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bounds_mask(shape: tuple[int, int, int], origin: np.ndarray, lo, hi) -> np.ndarray:
    """Return cells whose centres fall inside the axis-aligned millimetre box."""
    axes = [origin[i] + (np.arange(shape[i]) + 0.5) * RESOLUTION_MM for i in range(3)]
    return (
        (axes[0][:, None, None] >= lo[0])
        & (axes[0][:, None, None] <= hi[0])
        & (axes[1][None, :, None] >= lo[1])
        & (axes[1][None, :, None] <= hi[1])
        & (axes[2][None, None, :] >= lo[2])
        & (axes[2][None, None, :] <= hi[2])
    )


def voxel_mesh(occupied: np.ndarray, origin: np.ndarray, name: str) -> trimesh.Trimesh:
    """Convert occupied cells to an indexed, greedily merged boundary mesh."""
    vertex_index: dict[tuple[int, int, int], int] = {}
    vertices: list[list[float]] = []
    faces: list[list[int]] = []

    def rectangles(mask: np.ndarray):
        remaining = mask.copy()
        while remaining.any():
            u0, v0 = np.argwhere(remaining)[0]
            v1 = int(v0)
            while v1 + 1 < remaining.shape[1] and remaining[u0, v1 + 1]:
                v1 += 1
            u1 = int(u0)
            while u1 + 1 < remaining.shape[0] and remaining[u1 + 1, v0 : v1 + 1].all():
                u1 += 1
            remaining[u0 : u1 + 1, v0 : v1 + 1] = False
            yield int(u0), u1 + 1, int(v0), v1 + 1

    def add_quad(corners: tuple[tuple[int, int, int], ...]) -> None:
        quad: list[int] = []
        for key in corners:
            if key not in vertex_index:
                vertex_index[key] = len(vertices)
                vertices.append(
                    [
                        float(origin[0] + key[0] * RESOLUTION_MM),
                        float(origin[1] + key[1] * RESOLUTION_MM),
                        float(origin[2] + key[2] * RESOLUTION_MM),
                    ]
                )
            quad.append(vertex_index[key])
        faces.append([quad[0], quad[1], quad[2]])
        faces.append([quad[0], quad[2], quad[3]])

    for dx, dy, dz in ((-1, 0, 0), (1, 0, 0), (0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1)):
        neighbor = np.zeros_like(occupied)
        if dx == -1:
            neighbor[1:, :, :] = occupied[:-1, :, :]
        elif dx == 1:
            neighbor[:-1, :, :] = occupied[1:, :, :]
        elif dy == -1:
            neighbor[:, 1:, :] = occupied[:, :-1, :]
        elif dy == 1:
            neighbor[:, :-1, :] = occupied[:, 1:, :]
        elif dz == -1:
            neighbor[:, :, 1:] = occupied[:, :, :-1]
        else:
            neighbor[:, :, :-1] = occupied[:, :, 1:]

        exposed = occupied & ~neighbor
        if dx:
            for i in range(exposed.shape[0]):
                for j0, j1, k0, k1 in rectangles(exposed[i, :, :]):
                    x = i if dx < 0 else i + 1
                    corners = ((x, j0, k0), (x, j0, k1), (x, j1, k1), (x, j1, k0)) if dx < 0 else ((x, j0, k0), (x, j1, k0), (x, j1, k1), (x, j0, k1))
                    add_quad(corners)
        elif dy:
            for j in range(exposed.shape[1]):
                for i0, i1, k0, k1 in rectangles(exposed[:, j, :]):
                    y = j if dy < 0 else j + 1
                    corners = ((i0, y, k0), (i1, y, k0), (i1, y, k1), (i0, y, k1)) if dy < 0 else ((i0, y, k0), (i0, y, k1), (i1, y, k1), (i1, y, k0))
                    add_quad(corners)
        else:
            for k in range(exposed.shape[2]):
                for i0, i1, j0, j1 in rectangles(exposed[:, :, k]):
                    z = k if dz < 0 else k + 1
                    corners = ((i0, j0, z), (i0, j1, z), (i1, j1, z), (i1, j0, z)) if dz < 0 else ((i0, j0, z), (i1, j0, z), (i1, j1, z), (i0, j1, z))
                    add_quad(corners)

    mesh = trimesh.Trimesh(np.asarray(vertices), np.asarray(faces), process=True)
    if not mesh.is_watertight:
        # Greedy planes can create topological T-junctions where details meet.
        # Fall back to cell faces at the locked 0.5 mm manufacturing tolerance;
        # this preserves an actually watertight slicer input.
        vertex_index.clear()
        vertices.clear()
        faces.clear()
        face_defs = (
            ((-1, 0, 0), ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0))),
            ((1, 0, 0), ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))),
            ((0, -1, 0), ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1))),
            ((0, 1, 0), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0))),
            ((0, 0, -1), ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0))),
            ((0, 0, 1), ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))),
        )
        for (dx, dy, dz), corners in face_defs:
            neighbor = np.zeros_like(occupied)
            if dx == -1:
                neighbor[1:, :, :] = occupied[:-1, :, :]
            elif dx == 1:
                neighbor[:-1, :, :] = occupied[1:, :, :]
            elif dy == -1:
                neighbor[:, 1:, :] = occupied[:, :-1, :]
            elif dy == 1:
                neighbor[:, :-1, :] = occupied[:, 1:, :]
            elif dz == -1:
                neighbor[:, :, 1:] = occupied[:, :, :-1]
            else:
                neighbor[:, :, :-1] = occupied[:, :, 1:]
            for i, j, k in np.argwhere(occupied & ~neighbor):
                add_quad(tuple((int(i + ox), int(j + oy), int(k + oz)) for ox, oy, oz in corners))
        mesh = trimesh.Trimesh(np.asarray(vertices), np.asarray(faces), process=True)
    mesh.remove_unreferenced_vertices()
    if mesh.volume < 0:
        mesh.invert()
    mesh.metadata["name"] = name
    return mesh


def component_count(mesh: trimesh.Trimesh) -> int:
    # Keep QA independent of optional scipy/networkx graph engines.
    parent = np.arange(len(mesh.vertices), dtype=np.int64)

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = int(parent[value])
        return value

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for a, b, c in mesh.faces:
        union(int(a), int(b))
        union(int(b), int(c))
    referenced = np.unique(mesh.faces.reshape(-1))
    return len({find(int(index)) for index in referenced})


def validate_printable(mesh: trimesh.Trimesh, name: str) -> dict:
    report = {
        "name": name,
        "watertight": bool(mesh.is_watertight),
        "windingConsistent": bool(mesh.is_winding_consistent),
        "finite": bool(np.isfinite(mesh.vertices).all()),
        "connectedComponents": component_count(mesh),
        "volumeMm3": round(float(mesh.volume), 3),
        "boundsMm": np.round(mesh.bounds, 3).tolist(),
        "triangleCount": int(len(mesh.faces)),
    }
    if not all((report["watertight"], report["windingConsistent"], report["finite"])):
        raise RuntimeError(f"{name} failed closed-mesh QA: {report}")
    if report["connectedComponents"] != 1 or report["volumeMm3"] <= 0:
        raise RuntimeError(f"{name} failed connected-positive-solid QA: {report}")
    return report


def make_base(design: dict) -> trimesh.Trimesh:
    width, depth, _ = design["outerEnvelopeMm"]
    height = design["baseHeightMm"]
    wall = design["wallMm"]
    floor = design["floorMm"]
    margin = 1.0
    origin = np.array([-width / 2 - margin, -depth / 2 - margin, -margin])
    shape = tuple(int(np.ceil(v / RESOLUTION_MM)) for v in (width + 2 * margin, depth + 2 * margin, height + 2 * margin))
    solid = bounds_mask(shape, origin, (-width / 2, -depth / 2, 0), (width / 2, depth / 2, height))
    cavity = bounds_mask(shape, origin, (-width / 2 + wall, -depth / 2 + wall, floor), (width / 2 - wall, depth / 2 - wall, height + margin))
    solid &= ~cavity

    usb = design["usbServiceOpening"]
    cx, cy, cz = usb["centerMm"]
    opening_w, opening_h = usb["sizeMm"]
    usb_cut = bounds_mask(shape, origin, (cx - opening_w / 2, cy - wall - margin, cz - opening_h / 2), (cx + opening_w / 2, cy + margin, cz + opening_h / 2))
    solid &= ~usb_cut

    snap = design["snapFit"]
    recess_z0 = height - snap["hookHeightMm"] - snap["engagementMm"]
    for x, y in ((-width / 2, -12), (width / 2, -12), (-width / 2, 12), (width / 2, 12)):
        if x < 0:
            lo, hi = (x - margin, y - 3, recess_z0), (x + wall + snap["hookDepthMm"], y + 3, height + margin)
        else:
            lo, hi = (x - wall - snap["hookDepthMm"], y - 3, recess_z0), (x + margin, y + 3, height + margin)
        solid &= ~bounds_mask(shape, origin, lo, hi)
    return voxel_mesh(solid, origin, "xiao-qwiic-enclosure-base")


def make_lid(design: dict) -> trimesh.Trimesh:
    width, depth, _ = design["outerEnvelopeMm"]
    top = design["lidTopMm"]
    wall = design["wallMm"]
    clearance = design["movingClearanceMm"]
    skirt = 3.0
    margin = 1.0
    origin = np.array([-width / 2 - margin, -depth / 2 - margin, -skirt - margin])
    shape = tuple(int(np.ceil(v / RESOLUTION_MM)) for v in (width + 2 * margin, depth + 2 * margin, skirt + top + 2 * margin))
    solid = bounds_mask(shape, origin, (-width / 2, -depth / 2, 0), (width / 2, depth / 2, top))
    outer_skirt = bounds_mask(shape, origin, (-width / 2 + wall + clearance, -depth / 2 + wall + clearance, -skirt), (width / 2 - wall - clearance, depth / 2 - wall - clearance, 0))
    inner_skirt = bounds_mask(shape, origin, (-width / 2 + 2 * wall + clearance, -depth / 2 + 2 * wall + clearance, -skirt - margin), (width / 2 - 2 * wall - clearance, depth / 2 - 2 * wall - clearance, margin))
    solid |= outer_skirt & ~inner_skirt

    airflow = design["airflowOpening"]
    cx, cy, _ = airflow["centerMm"]
    region_w, region_d = airflow["regionMm"]
    slot_w = airflow["slotWidthMm"]
    bar_w = airflow["barWidthMm"]
    x = cx - region_w / 2
    while x + slot_w <= cx + region_w / 2 + 1e-6:
        cut = bounds_mask(shape, origin, (x, cy - region_d / 2, -margin), (x + slot_w, cy + region_d / 2, top + margin))
        solid &= ~cut
        x += slot_w + bar_w

    snap = design["snapFit"]
    hook_z0 = -snap["hookHeightMm"]
    hook_depth = snap["hookDepthMm"]
    for side in (-1, 1):
        x0 = side * (width / 2 - wall - clearance)
        for y in (-12, 12):
            if side < 0:
                lo, hi = (x0 - hook_depth, y - 2.4, hook_z0), (x0 + wall, y + 2.4, 0)
            else:
                lo, hi = (x0 - wall, y - 2.4, hook_z0), (x0 + hook_depth, y + 2.4, 0)
            solid |= bounds_mask(shape, origin, lo, hi)
    return voxel_mesh(solid, origin, "xiao-qwiic-enclosure-lid")


def make_tray(design: dict) -> trimesh.Trimesh:
    width, depth, _ = design["outerEnvelopeMm"]
    wall = design["wallMm"]
    floor = design["floorMm"]
    loop = design["serviceLoop"]
    margin = 1.0
    z0 = floor + 0.4
    height = max(3.0, loop["channelHeightMm"])
    origin = np.array([-width / 2 - margin, -depth / 2 - margin, z0 - margin])
    shape = tuple(int(np.ceil(v / RESOLUTION_MM)) for v in (width + 2 * margin, depth + 2 * margin, height + 2 * margin))
    solid = bounds_mask(shape, origin, (-width / 2 + wall + 0.6, -depth / 2 + wall + 0.6, z0), (width / 2 - wall - 0.6, depth / 2 - wall - 0.6, z0 + 1.2))

    axes = [origin[i] + (np.arange(shape[i]) + 0.5) * RESOLUTION_MM for i in range(3)]
    xx, yy = np.meshgrid(axes[0], axes[1], indexing="ij")
    cx, cy, _ = loop["centerMm"]
    radial = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    ring = (radial >= loop["channelRadiusMm"] - loop["channelWallMm"] / 2) & (radial <= loop["channelRadiusMm"] + loop["channelWallMm"] / 2)
    z_ring = (axes[2] >= z0) & (axes[2] <= z0 + loop["channelHeightMm"])
    solid |= ring[:, :, None] & z_ring[None, None, :]

    for px, py, _ in design["placements"].values():
        pad = bounds_mask(shape, origin, (px - 6, py - 6, z0), (px + 6, py + 6, z0 + height))
        solid |= pad
    return voxel_mesh(solid, origin, "xiao-qwiic-enclosure-tray")


def export_outputs(output: Path) -> dict:
    design = json.loads(DESIGN_PATH.read_text())
    output.mkdir(parents=True, exist_ok=True)
    stl_dir = output / "stl"
    model_dir = output / "models"
    report_dir = output / "reports"
    for directory in (stl_dir, model_dir, report_dir):
        directory.mkdir(parents=True, exist_ok=True)

    meshes = {"base": make_base(design), "lid": make_lid(design), "tray": make_tray(design)}
    qa = {name: validate_printable(mesh, name) for name, mesh in meshes.items()}
    paths: dict[str, Path] = {}
    for name, mesh in meshes.items():
        path = stl_dir / f"xiao-qwiic-co2-{name}.stl"
        mesh.export(path)
        paths[name] = path

    # Closed-reference STL is intentionally an assembly reference, not a single
    # printable body. The three production STLs above remain the slicer inputs.
    closed_parts = [meshes["base"].copy(), meshes["tray"].copy(), meshes["lid"].copy()]
    closed_parts[2].apply_translation([0, 0, design["baseHeightMm"]])
    closed_reference = trimesh.util.concatenate(closed_parts)
    closed_path = stl_dir / "xiao-qwiic-co2-closed-reference-NOT-FOR-PRINT.stl"
    closed_reference.export(closed_path)
    paths["closedReference"] = closed_path

    scene = trimesh.Scene()
    colors = {"base": [26, 34, 39, 255], "tray": [55, 75, 79, 255], "lid": [44, 57, 62, 245]}
    for name in ("base", "tray", "lid"):
        glb_mesh = meshes[name].copy()
        if name == "lid":
            glb_mesh.apply_translation([0, 0, design["baseHeightMm"]])
        glb_mesh.apply_scale(0.001)
        glb_mesh.visual.vertex_colors = np.tile(np.asarray(colors[name], dtype=np.uint8), (len(glb_mesh.vertices), 1))
        scene.add_geometry(glb_mesh, node_name=f"housing:{name}", geom_name=f"housing:{name}")
    glb_path = model_dir / "xiao-qwiic-co2-enclosure-closed.glb"
    glb_path.write_bytes(scene.export(file_type="glb"))
    paths["glb"] = glb_path

    manifest = {
        "schemaVersion": "makeable-housing/v2",
        "assetId": "xiao-qwiic-co2-enclosure",
        "designContract": str(DESIGN_PATH.relative_to(ROOT)),
        "designSha256": sha256(DESIGN_PATH),
        "units": {"stl": "millimetres", "glb": "metres"},
        "runtimeVisualPasses": design["runtimeVisualPasses"],
        "printable": {name: {"path": str(paths[name].relative_to(output)), "sha256": sha256(paths[name]), "qa": qa[name]} for name in ("base", "lid", "tray")},
        "referenceOnly": {"path": str(closed_path.relative_to(output)), "sha256": sha256(closed_path), "printable": False, "expectedBodies": 3},
        "assemblyGlb": {"path": str(glb_path.relative_to(output)), "sha256": sha256(glb_path)},
        "alignment": {
            "outerEnvelopeMm": design["outerEnvelopeMm"],
            "placementsMm": design["placements"],
            "usbServiceOpening": design["usbServiceOpening"],
            "airflowOpening": design["airflowOpening"],
            "serviceLoop": design["serviceLoop"],
        },
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    (report_dir / "printability.json").write_text(json.dumps(qa, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    destination = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUTPUT
    print(json.dumps(export_outputs(destination), indent=2))
