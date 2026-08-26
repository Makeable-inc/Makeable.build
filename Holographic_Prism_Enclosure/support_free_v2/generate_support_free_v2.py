#!/usr/bin/env python3
"""Generate the support-free V2 holographic prism enclosure.

All dimensions are millimetres. +Y is rearward, toward the USB-C cable.
Every exported part is already oriented with a flat Z=0 face on the print bed.
"""

from __future__ import annotations

import json
import math
import struct
import zipfile
from collections import Counter
from pathlib import Path

import cadquery as cq
from cadquery import exporters


ROOT = Path(__file__).resolve().parent
EXPORTS = ROOT / "exports"
RENDERS = ROOT / "renders"
VALIDATION = ROOT / "validation"

# Component data and fit policy. This is the physical running clearance at
# every intended mating surface, not the exporter/slicer precision.
CLEARANCE_PER_SIDE = 0.15
PRISM = (30.0, 30.0, 30.0)
PRISM_POCKET = (
    PRISM[0] + 2 * CLEARANCE_PER_SIDE,
    PRISM[1] + 2 * CLEARANCE_PER_SIDE,
)
OLED_PCB = (34.0, 47.0, 1.20)
OLED_PANEL = (33.90, 37.30, 1.60)
OLED_ACTIVE = (26.86, 26.86)
OLED_ACTIVE_CENTER_Y = 2.77
OLED_HOLE_DIAMETER = 2.20
OLED_PEG_DIAMETER = OLED_HOLE_DIAMETER - 2 * CLEARANCE_PER_SIDE
OLED_HOLE_PITCH = (28.0, 42.0)
ESP_PCB = (18.0, 22.52, 1.0)
ESP_TOTAL_ENVELOPE_HEIGHT = 4.10
ESP_USB_INCLUDED_LENGTH = 24.52
DUPONT_HOUSING_LENGTH = 14.0

# V2 enclosure stack.
BODY_OUTER = (48.0, 63.0, 36.50)
BODY_INNER = (43.20, 58.20)
BODY_RADIUS = 4.0
FLOOR = 2.0
OLED_UNDERSIDE_Z = 33.0
OLED_FACE_TOP_Z = OLED_UNDERSIDE_Z + OLED_PANEL[2] + OLED_PCB[2]
FRAME_BOTTOM_Z = 36.50
FRAME_OUTER = (
    BODY_INNER[0] - 2 * CLEARANCE_PER_SIDE,
    BODY_INNER[1] - 2 * CLEARANCE_PER_SIDE,
)
FRAME_PLATE = 3.0
PRISM_SEAT_LOCAL_Z = 0.60
COLLAR_HEIGHT = 3.50
COLLAR_WALL = 2.0
LIGHT_WINDOW = (27.10, 27.10)
ESP_CENTER_Y = 17.50
ESP_SUPPORT_Z = 3.20


def box(x: float, y: float, z: float, cx=0.0, cy=0.0, z0=0.0) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .box(x, y, z, centered=(True, True, False))
        .translate((cx, cy, z0))
    )


def rounded_box(x: float, y: float, z: float, radius: float, z0=0.0) -> cq.Workplane:
    result = box(x, y, z, z0=z0)
    return result.edges("|Z").fillet(radius) if radius else result


def cylinder(diameter: float, height: float, x=0.0, y=0.0, z0=0.0) -> cq.Workplane:
    return (
        cq.Workplane("XY")
        .center(x, y)
        .circle(diameter / 2)
        .extrude(height)
        .translate((0, 0, z0))
    )


def xz_prism(points: list[tuple[float, float]], y_width: float, y=0.0) -> cq.Workplane:
    """Extrude an X/Z polygon symmetrically along Y."""
    return (
        cq.Workplane("XZ", origin=(0, y, 0))
        .polyline(points)
        .close()
        .extrude(y_width / 2, both=True)
    )


def yz_prism(points: list[tuple[float, float]], x_width: float, x=0.0) -> cq.Workplane:
    """Extrude a Y/Z polygon symmetrically along X."""
    return (
        cq.Workplane("YZ", origin=(x, 0, 0))
        .polyline(points)
        .close()
        .extrude(x_width / 2, both=True)
    )


def build_base() -> cq.Workplane:
    # Open-top shell. The only broad horizontal face is the bed-supported floor.
    outer = rounded_box(*BODY_OUTER, BODY_RADIUS)
    cavity = rounded_box(
        BODY_INNER[0], BODY_INNER[1], BODY_OUTER[2] - FLOOR + 0.4, 2.0, z0=FLOOR
    )
    base = outer.cut(cavity)

    # Rear USB-C cable aperture. A 12 mm vertical opening closes with a 49.4°
    # pitched roof, so no bridge or support is generated above the connector.
    usb_arch = xz_prism(
        [(-6.0, 1.8), (6.0, 1.8), (6.0, 10.0), (0.0, 17.0), (-6.0, 10.0)],
        y_width=6.0,
        y=BODY_OUTER[1] / 2,
    )
    base = base.cut(usb_arch)

    # Four corner towers make a positive, level support for the removable
    # optical frame. They rise continuously from the enclosure floor.
    for x in (-20.15, 20.15):
        for y in (-27.15, 27.15):
            base = base.union(box(2.6, 2.6, FRAME_BOTTOM_Z - FLOOR, x, y, FLOOR))

    # OLED mounting: continuous pillars, clearance-derived pegs in Ø2.20 holes, and small
    # printable tapered beads. The board is installed face-up from above.
    for x in (-OLED_HOLE_PITCH[0] / 2, OLED_HOLE_PITCH[0] / 2):
        for y in (-OLED_HOLE_PITCH[1] / 2, OLED_HOLE_PITCH[1] / 2):
            base = base.union(cylinder(5.2, OLED_UNDERSIDE_Z - FLOOR, x, y, FLOOR))
            base = base.union(
                cylinder(OLED_PEG_DIAMETER, OLED_PCB[2] + 0.05, x, y, OLED_UNDERSIDE_Z)
            )
            bead_z = OLED_UNDERSIDE_Z + OLED_PCB[2]
            lower_bead = cq.Solid.makeCone(
                OLED_PEG_DIAMETER / 2,
                1.16,
                0.32,
                cq.Vector(x, y, bead_z),
                cq.Vector(0, 0, 1),
            )
            upper_bead = cq.Solid.makeCone(
                1.16, 0.76, 0.46, cq.Vector(x, y, bead_z + 0.32), cq.Vector(0, 0, 1)
            )
            bead = cq.Workplane("XY").newObject([lower_bead]).union(
                cq.Workplane("XY").newObject([upper_bead])
            )
            base = base.union(bead)

    # ESP32-C3 Super Mini sits horizontally with USB-C aimed rearward. Four
    # pads carry the PCB. Rear stops straddle the connector; a front flexible
    # tab catches the antenna edge after the board is pushed down.
    for x in (-7.1, 7.1):
        for y in (ESP_CENTER_Y - 8.0, ESP_CENTER_Y + 8.0):
            base = base.union(box(2.8, 2.8, ESP_SUPPORT_Z - FLOOR, x, y, FLOOR))

    rear_edge_y = ESP_CENTER_Y + ESP_PCB[1] / 2
    for x in (-7.7, 7.7):
        base = base.union(box(2.6, 1.4, 3.2, x, rear_edge_y + 0.55, FLOOR))

    front_edge_y = ESP_CENTER_Y - ESP_PCB[1] / 2
    base = base.union(box(8.0, 1.2, 3.8, 0.0, front_edge_y - 0.75, FLOOR))
    # 50° lower surface and 56° insertion ramp: both are support-free.
    front_hook = yz_prism(
        [
            (front_edge_y - 0.15, 4.10),
            (front_edge_y + 0.45, 4.82),
            (front_edge_y + 0.45, 5.20),
            (front_edge_y - 0.15, 6.10),
        ],
        x_width=7.2,
    )
    base = base.union(front_hook)

    # Two long, open gutters keep the wire bundle away from the ESP board and
    # provide a generous bending path instead of forcing a sharp fold.
    for x in (-18.1, 18.1):
        base = base.union(box(2.0, 29.0, 1.0, x, 1.0, FLOOR))

    # Side-wall cantilevers retain the flat optical frame. Vertical relief
    # slots isolate each tab; the catches are all sloped and grow upward.
    for side in (-1, 1):
        x_wall = side * (BODY_INNER[0] / 2 + 1.20)
        for y in (-5.5, 5.5):
            base = base.cut(box(3.4, 1.25, 7.3, x_wall, y, 29.7))

        # Continue the isolated wall tab above the rim. A 0.20 mm overlap with
        # the rim makes this one continuous solid instead of a tangent contact.
        base = base.union(box(2.4, 9.7, 4.0, x_wall, 0.0, 36.30))

        x_inner = side * (BODY_INNER[0] / 2)
        if side > 0:
            catch_points = [
                (x_inner, 37.58),
                (x_inner - 0.50, 38.20),
                (x_inner - 0.50, 39.18),
                (x_inner, 40.30),
            ]
        else:
            catch_points = [
                (x_inner, 37.58),
                (x_inner, 40.30),
                (x_inner + 0.50, 39.18),
                (x_inner + 0.50, 38.20),
            ]
        base = base.union(xz_prism(catch_points, y_width=9.7))

    return base.clean()


def build_optical_frame() -> cq.Workplane:
    # Flat-backed frame: it goes directly on the bed exactly as exported.
    frame = rounded_box(FRAME_OUTER[0], FRAME_OUTER[1], FRAME_PLATE, 3.2)
    frame = frame.cut(
        box(
            LIGHT_WINDOW[0],
            LIGHT_WINDOW[1],
            FRAME_PLATE + 0.4,
            cy=OLED_ACTIVE_CENTER_Y,
            z0=-0.2,
        )
    )
    frame = frame.cut(
        box(
            PRISM_POCKET[0],
            PRISM_POCKET[1],
            FRAME_PLATE - PRISM_SEAT_LOCAL_Z + 0.2,
            cy=OLED_ACTIVE_CENTER_Y,
            z0=PRISM_SEAT_LOCAL_Z,
        )
    )

    collar_outer = box(
        PRISM_POCKET[0] + 2 * COLLAR_WALL,
        PRISM_POCKET[1] + 2 * COLLAR_WALL,
        COLLAR_HEIGHT,
        cy=OLED_ACTIVE_CENTER_Y,
        z0=FRAME_PLATE,
    )
    collar_inner = box(
        PRISM_POCKET[0],
        PRISM_POCKET[1],
        COLLAR_HEIGHT + 0.3,
        cy=OLED_ACTIVE_CENTER_Y,
        z0=FRAME_PLATE - 0.1,
    )
    frame = frame.union(collar_outer.cut(collar_inner))

    # Widening-upward 0.4 mm lead-in for easy prism placement.
    lead = (
        cq.Workplane(
            "XY",
            origin=(0, OLED_ACTIVE_CENTER_Y, FRAME_PLATE + COLLAR_HEIGHT - 0.90),
        )
        .rect(PRISM_POCKET[0], PRISM_POCKET[1])
        .workplane(offset=1.0)
        .rect(PRISM_POCKET[0] + 0.40, PRISM_POCKET[1] + 0.40)
        .loft(combine=True)
    )
    frame = frame.cut(lead)

    # Open-top side notches accept the base catches. The notch floor is built
    # on solid material and does not create a floating roof.
    for side in (-1, 1):
        frame = frame.cut(
            box(
                1.6,
                10.2,
                FRAME_PLATE - 1.70 + 0.2,
                side * (FRAME_OUTER[0] / 2 - 0.35),
                0.0,
                1.70,
            )
        )

    return frame.clean()


def build_prism_fit_ring() -> cq.Workplane:
    outer = box(PRISM_POCKET[0] + 2 * COLLAR_WALL, PRISM_POCKET[1] + 2 * COLLAR_WALL, 4.0)
    inner = box(PRISM_POCKET[0], PRISM_POCKET[1], 4.4, z0=-0.2)
    ring = outer.cut(inner)
    lead = (
        cq.Workplane("XY", origin=(0, 0, 3.10))
        .rect(PRISM_POCKET[0], PRISM_POCKET[1])
        .workplane(offset=1.0)
        .rect(PRISM_POCKET[0] + 0.40, PRISM_POCKET[1] + 0.40)
        .loft(combine=True)
    )
    return ring.cut(lead).clean()


def reference_components():
    oled_pcb = box(*OLED_PCB, z0=OLED_UNDERSIDE_Z)
    for x in (-OLED_HOLE_PITCH[0] / 2, OLED_HOLE_PITCH[0] / 2):
        for y in (-OLED_HOLE_PITCH[1] / 2, OLED_HOLE_PITCH[1] / 2):
            oled_pcb = oled_pcb.cut(cylinder(OLED_HOLE_DIAMETER, 1.6, x, y, OLED_UNDERSIDE_Z - 0.2))
    oled_panel = box(
        OLED_PANEL[0], OLED_PANEL[1], OLED_PANEL[2], cy=0.05, z0=OLED_UNDERSIDE_Z + OLED_PCB[2]
    )

    oled_dupont = box(10.16, 2.54, DUPONT_HOUSING_LENGTH, cy=21.0, z0=OLED_UNDERSIDE_Z - DUPONT_HOUSING_LENGTH)

    esp_pcb = box(
        ESP_PCB[0], ESP_PCB[1], ESP_TOTAL_ENVELOPE_HEIGHT, cy=ESP_CENTER_Y, z0=ESP_SUPPORT_Z
    )
    usb_extra = ESP_USB_INCLUDED_LENGTH - ESP_PCB[1]
    esp_usb = box(
        9.2,
        usb_extra,
        3.3,
        cy=ESP_CENTER_Y + ESP_PCB[1] / 2 + usb_extra / 2,
        z0=ESP_SUPPORT_Z + 0.2,
    )
    esp = esp_pcb.union(esp_usb)

    # Two reference rows model female Dupont housings fitted to the ESP side pins.
    esp_dupont_left = box(2.54, 20.32, DUPONT_HOUSING_LENGTH, -10.4, ESP_CENTER_Y, ESP_SUPPORT_Z)
    esp_dupont_right = box(2.54, 20.32, DUPONT_HOUSING_LENGTH, 10.4, ESP_CENTER_Y, ESP_SUPPORT_Z)
    prism = box(*PRISM, cy=OLED_ACTIVE_CENTER_Y, z0=FRAME_BOTTOM_Z + PRISM_SEAT_LOCAL_Z)
    return oled_pcb, oled_panel, oled_dupont, esp, esp_dupont_left, esp_dupont_right, prism


def bounds(shape: cq.Workplane) -> dict[str, float]:
    bb = shape.val().BoundingBox()
    return {
        "xmin": bb.xmin,
        "xmax": bb.xmax,
        "ymin": bb.ymin,
        "ymax": bb.ymax,
        "zmin": bb.zmin,
        "zmax": bb.zmax,
    }


def intersection_volume(a: cq.Workplane, b: cq.Workplane) -> float:
    return sum(s.Volume() for s in a.intersect(b).solids().vals())


def stl_is_manifold(shape: cq.Workplane, tolerance=1e-6):
    vertices, triangles = shape.val().tessellate(0.05, 0.12)
    coords = [(v.x, v.y, v.z) for v in vertices]

    def key(point):
        return tuple(round(c / tolerance) for c in point)

    edges = Counter()
    for tri in triangles:
        ids = [key(coords[i]) for i in tri]
        for a, b in ((ids[0], ids[1]), (ids[1], ids[2]), (ids[2], ids[0])):
            edges[tuple(sorted((a, b)))] += 1
    bad_edges = sum(count != 2 for count in edges.values())
    return len(vertices), len(triangles), bad_edges == 0, bad_edges


def overhang_audit(stl_path: Path, max_overhang_from_horizontal=45.0):
    """Audit the oriented triangles in the exact binary STL sent to the slicer."""
    threshold = -math.cos(math.radians(max_overhang_from_horizontal))
    unsupported = []
    total_downward = 0
    with stl_path.open("rb") as handle:
        handle.read(80)
        triangle_count = struct.unpack("<I", handle.read(4))[0]
        for _ in range(triangle_count):
            values = struct.unpack("<12fH", handle.read(50))
            nx, ny, nz = values[:3]
            vertices = [values[3:6], values[6:9], values[9:12]]
            norm = math.sqrt(nx * nx + ny * ny + nz * nz)
            if norm < 1e-10:
                continue
            nz /= norm
            cz = sum(vertex[2] for vertex in vertices) / 3
            if nz < -1e-6:
                total_downward += 1
            # Z=0 downward faces are supported by the bed and are exempt.
            if nz < threshold - 1e-6 and cz > 0.08:
                unsupported.append({"centroid_z": round(cz, 4), "normal_z": round(nz, 5)})
    return {
        "limit_degrees_from_horizontal": max_overhang_from_horizontal,
        "downward_triangles": total_downward,
        "unsupported_triangles_above_bed": len(unsupported),
        "worst_examples": sorted(unsupported, key=lambda item: item["normal_z"])[:12],
    }


def export_part(filename: str, shape: cq.Workplane):
    exporters.export(shape, str(EXPORTS / f"{filename}.step"))
    exporters.export(
        shape,
        str(EXPORTS / f"{filename}.stl"),
        tolerance=0.035,
        angularTolerance=0.12,
    )


def render_scene(base, frame):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    refs = reference_components()

    def add_shape(ax, shape, color, alpha=1.0, shift=(0, 0, 0)):
        verts, tris = shape.val().tessellate(0.16, 0.26)
        xyz = [(v.x + shift[0], v.y + shift[1], v.z + shift[2]) for v in verts]
        faces = [[xyz[i] for i in tri] for tri in tris]
        mesh = Poly3DCollection(faces, facecolor=color, edgecolor="none", alpha=alpha)
        ax.add_collection3d(mesh)

    def style(ax, elev=25, azim=-55):
        ax.set_xlim(-38, 38)
        ax.set_ylim(-40, 45)
        ax.set_zlim(0, 74)
        ax.set_box_aspect((76, 85, 74))
        ax.view_init(elev=elev, azim=azim)
        ax.set_axis_off()

    # Assembled view, with a translucent shell to show routing space.
    fig = plt.figure(figsize=(9, 9), dpi=180)
    ax = fig.add_subplot(111, projection="3d")
    add_shape(ax, base, "#626a70", 0.32)
    add_shape(ax, frame, "#23282c", 0.95, (0, 0, FRAME_BOTTOM_Z))
    colors = ["#1d5fbf", "#111111", "#f6c342", "#1e7c4b", "#d77b25", "#d77b25", "#a8e6f0"]
    alphas = [0.75, 0.75, 0.85, 0.92, 0.55, 0.55, 0.28]
    for shape, color, alpha in zip(refs, colors, alphas):
        add_shape(ax, shape, color, alpha)
    style(ax)
    fig.tight_layout(pad=0)
    fig.savefig(RENDERS / "support_free_v2_assembly.png", transparent=True)
    plt.close(fig)

    # Exploded view makes the two printable parts and print orientations obvious.
    fig = plt.figure(figsize=(9, 9), dpi=180)
    ax = fig.add_subplot(111, projection="3d")
    add_shape(ax, base, "#626a70", 0.92)
    add_shape(ax, frame, "#23282c", 0.95, (0, 0, 49.0))
    add_shape(ax, refs[-1], "#a8e6f0", 0.28, (0, 0, 24.0))
    style(ax, elev=23, azim=-52)
    ax.set_zlim(0, 105)
    fig.tight_layout(pad=0)
    fig.savefig(RENDERS / "support_free_v2_exploded.png", transparent=True)
    plt.close(fig)


def make_package():
    package = ROOT / "Holographic_Prism_Enclosure_SUPPORT_FREE_V2.zip"
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(EXPORTS.glob("*")):
            if path.is_file():
                archive.write(path, f"exports/{path.name}")
        for path in sorted(RENDERS.glob("*.png")):
            archive.write(path, f"renders/{path.name}")
        for path in sorted(VALIDATION.glob("*")):
            if path.is_file() and path.suffix in {".json", ".3mf", ".png"}:
                archive.write(path, f"validation/{path.name}")
        for path in (ROOT / "README.md", ROOT / "generate_support_free_v2.py"):
            if path.exists():
                archive.write(path, path.name)


def main():
    for folder in (EXPORTS, RENDERS, VALIDATION):
        folder.mkdir(parents=True, exist_ok=True)
    for folder in (EXPORTS, RENDERS):
        for old in folder.iterdir():
            if old.is_file():
                old.unlink()
    geometry_report = VALIDATION / "geometry_validation.json"
    if geometry_report.exists():
        geometry_report.unlink()

    base = build_base()
    frame = build_optical_frame()
    fit_ring = build_prism_fit_ring()

    export_part("01_support_free_base", base)
    export_part("02_support_free_optical_frame", frame)
    export_part("03_prism_fit_ring", fit_ring)

    assembly = cq.Assembly(name="support_free_v2")
    assembly.add(base, name="base", color=cq.Color(0.22, 0.24, 0.26))
    assembly.add(
        frame,
        name="snap_in_optical_frame",
        loc=cq.Location(cq.Vector(0, 0, FRAME_BOTTOM_Z)),
        color=cq.Color(0.08, 0.09, 0.10),
    )
    ref_names = ["oled_pcb", "oled_panel", "oled_dupont", "esp32", "esp_dupont_left", "esp_dupont_right", "prism"]
    for name, ref in zip(ref_names, reference_components()):
        assembly.add(ref, name=name)
    assembly.save(str(EXPORTS / "support_free_v2_reference_assembly.step"))

    results = {}
    for name, part in {
        "base": base,
        "optical_frame": frame,
        "prism_fit_ring": fit_ring,
    }.items():
        vertices, triangles, manifold, bad_edges = stl_is_manifold(part)
        results[name] = {
            "solid_count": len(part.solids().vals()),
            "bounds_mm": bounds(part),
            "volume_mm3": round(sum(s.Volume() for s in part.solids().vals()), 3),
            "mesh_vertices": vertices,
            "mesh_triangles": triangles,
            "manifold": manifold,
            "nonmanifold_edges": bad_edges,
            "overhang_audit": overhang_audit(EXPORTS / {
                "base": "01_support_free_base.stl",
                "optical_frame": "02_support_free_optical_frame.stl",
                "prism_fit_ring": "03_prism_fit_ring.stl",
            }[name]),
        }

    # Fit and clearance checks in assembled coordinates.
    assembled_frame = frame.translate((0, 0, FRAME_BOTTOM_Z))
    oled_pcb, oled_panel, oled_dupont, esp, esp_l, esp_r, prism = reference_components()
    results["assembly_checks"] = {
        "frame_clearance_per_side_mm": round((BODY_INNER[0] - FRAME_OUTER[0]) / 2, 3),
        "prism_clearance_per_side_mm": round((PRISM_POCKET[0] - PRISM[0]) / 2, 3),
        "oled_hole_radial_clearance_mm": round(
            (OLED_HOLE_DIAMETER - OLED_PEG_DIAMETER) / 2, 3
        ),
        "oled_dupont_housing_length_mm": DUPONT_HOUSING_LENGTH,
        "oled_dupont_bottom_z_mm": OLED_UNDERSIDE_Z - DUPONT_HOUSING_LENGTH,
        "clear_height_below_oled_dupont_mm": OLED_UNDERSIDE_Z - DUPONT_HOUSING_LENGTH - FLOOR,
        "clear_height_above_esp_envelope_mm": round(
            OLED_UNDERSIDE_Z - DUPONT_HOUSING_LENGTH - (ESP_SUPPORT_Z + ESP_TOTAL_ENVELOPE_HEIGHT), 3
        ),
        "screen_to_frame_gap_mm": round(FRAME_BOTTOM_Z - OLED_FACE_TOP_Z, 3),
        "screen_to_prism_gap_mm": round(
            FRAME_BOTTOM_Z + PRISM_SEAT_LOCAL_Z - OLED_FACE_TOP_Z, 3
        ),
        "prism_frame_collision_mm3": round(intersection_volume(prism, assembled_frame), 6),
        "esp_base_collision_mm3": round(intersection_volume(esp, base), 6),
        "oled_panel_frame_collision_mm3": round(intersection_volume(oled_panel, assembled_frame), 6),
        "usb_roof_slope_degrees": round(math.degrees(math.atan2(7.0, 6.0)), 2),
    }

    passed = True
    for name in ("base", "optical_frame", "prism_fit_ring"):
        item = results[name]
        passed &= item["solid_count"] == 1
        passed &= item["manifold"]
        passed &= abs(item["bounds_mm"]["zmin"]) < 0.01
        passed &= item["overhang_audit"]["unsupported_triangles_above_bed"] == 0
    checks = results["assembly_checks"]
    passed &= abs(checks["frame_clearance_per_side_mm"] - CLEARANCE_PER_SIDE) < 0.001
    passed &= abs(checks["prism_clearance_per_side_mm"] - CLEARANCE_PER_SIDE) < 0.001
    passed &= abs(checks["oled_hole_radial_clearance_mm"] - CLEARANCE_PER_SIDE) < 0.001
    passed &= checks["clear_height_below_oled_dupont_mm"] >= 15.0
    passed &= checks["clear_height_above_esp_envelope_mm"] >= 10.0
    passed &= checks["usb_roof_slope_degrees"] > 45.0
    results["all_geometry_checks_passed"] = bool(passed)

    with (VALIDATION / "geometry_validation.json").open("w") as handle:
        json.dump(results, handle, indent=2)

    render_scene(base, frame)
    make_package()
    print(json.dumps(results, indent=2))
    if not passed:
        raise SystemExit("One or more V2 geometry checks failed")


if __name__ == "__main__":
    main()
