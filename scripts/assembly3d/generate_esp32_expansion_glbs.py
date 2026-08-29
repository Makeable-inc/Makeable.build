#!/usr/bin/env python3
"""Generate deterministic, pin-complete ESP32 expansion-board GLBs.

Electrical interfaces and board geometry in this file come from the source URLs
recorded in each part manifest. Cosmetic IC packages are deliberately simplified;
they never define connector or mounting geometry.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

import numpy as np
import trimesh


COLORS = {
    "pcb": [18, 20, 22, 255],
    "pcb_edge": [42, 45, 48, 255],
    "gold": [212, 165, 55, 255],
    "silver": [185, 190, 196, 255],
    "black": [15, 16, 18, 255],
    "dark": [4, 5, 6, 255],
    "white": [235, 232, 220, 255],
    "green": [50, 135, 72, 255],
    "red": [190, 38, 42, 255],
    "yellow": [232, 190, 36, 255],
    "blue": [45, 92, 190, 255],
    "gray": [95, 101, 108, 255],
    "silk": [235, 235, 230, 255],
    "copper": [175, 92, 45, 255],
}


# A deliberately small, deterministic 5x7 drafting font.  The glyphs become
# actual GLB geometry instead of a raster texture, so legends stay crisp at
# oblique review angles and survive offline/content-addressed delivery.
FONT_5X7 = {
    " ": ["00000"] * 7,
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
    "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
    ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
}


class Builder:
    def __init__(self) -> None:
        self.scene = trimesh.Scene(base_frame="part-origin")

    def box(self, name: str, size, position, color="gray"):
        mesh = trimesh.creation.box(extents=np.asarray(size, dtype=float))
        mesh.visual.vertex_colors = np.tile(np.asarray(COLORS[color], dtype=np.uint8), (len(mesh.vertices), 1))
        transform = trimesh.transformations.translation_matrix(np.asarray(position, dtype=float))
        self.scene.add_geometry(mesh, node_name=name, geom_name=name, transform=transform)

    def cylinder(self, name: str, radius: float, height: float, position, color="gray", sections=24):
        mesh = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
        mesh.visual.vertex_colors = np.tile(np.asarray(COLORS[color], dtype=np.uint8), (len(mesh.vertices), 1))
        transform = trimesh.transformations.translation_matrix(np.asarray(position, dtype=float))
        self.scene.add_geometry(mesh, node_name=name, geom_name=name, transform=transform)

    def mesh(self, name: str, mesh: trimesh.Trimesh, color="gray"):
        if mesh is None or len(mesh.vertices) == 0:
            return
        mesh.visual.vertex_colors = np.tile(np.asarray(COLORS[color], dtype=np.uint8), (len(mesh.vertices), 1))
        self.scene.add_geometry(mesh, node_name=name, geom_name=name)

    def export(self, output: Path):
        # Authoring is in millimetres. glTF/GLB is exported in metres.
        self.scene.apply_scale(0.001)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(self.scene.export(file_type="glb"))

    def marker(self, name: str, position):
        # A 10-micron semantic locator: discoverable in GLB hierarchy without
        # materially changing the visual model or collision envelope.
        self.box(name, [0.01, 0.01, 0.01], position, "dark")


def add_pcb(builder: Builder, width: float, height: float, holes):
    builder.box("body:pcb", [width, height, 1.6], [0, 0, 0], "pcb")
    for index, (x, y, diameter) in enumerate(holes, 1):
        # Dark through-hole barrels are separate semantic geometry. The visible
        # bore is conservative and does not claim a CSG-machined solid.
        builder.cylinder(f"mount:m{index}:bore", diameter / 2, 1.82, [x, y, 0], "dark")
        builder.cylinder(f"mount:m{index}:annulus", diameter / 2 + 0.65, 0.08, [x, y, 0.85], "silver")
        builder.cylinder(f"mount:m{index}:opening", diameter / 2, 0.1, [x, y, 0.91], "dark")
        builder.marker(f"mount:m{index}", [x, y, 0.91])


def add_male_pin(builder: Builder, name: str, x: float, y: float, color="gold", height=7.2):
    builder.box(name, [0.64, 0.64, height], [x, y, 0.8 + height / 2], color)


def add_female_row(builder: Builder, name: str, x: float, ys, labels, body_color="green", body_width=3.5):
    ys = list(ys)
    labels = list(labels)
    length = (max(ys) - min(ys)) + 3.2
    builder.box(f"connector:{name}:housing", [body_width, length, 6.5], [x, (max(ys) + min(ys)) / 2, 0.8 + 3.25], body_color)
    for y, label in zip(ys, labels):
        builder.box(f"connector:{name}:socket:{label}:opening", [1.35, 1.35, 0.22], [x, y, 7.12], "dark")
        builder.box(f"connector:{name}:contact:{label}", [0.45, 0.45, 1.8], [x, y, 2.6], "gold")


def add_horizontal_socket_row(builder: Builder, name: str, y: float, xs, labels):
    xs = list(xs)
    labels = list(labels)
    length = (max(xs) - min(xs)) + 3.2
    builder.box(f"connector:{name}:housing", [length, 2.5, 3.2], [(max(xs) + min(xs)) / 2, y, 2.4], "black")
    for x, label in zip(xs, labels):
        builder.box(f"connector:{name}:socket:{label}:opening", [1.35, 1.35, 0.22], [x, y, 4.06], "dark")
        builder.box(f"connector:{name}:contact:{label}", [0.45, 0.45, 1.4], [x, y, 2.1], "gold")


def add_silk_bar(builder: Builder, name: str, size, position):
    builder.box(f"silkscreen:{name}", [size[0], size[1], 0.035], [position[0], position[1], 0.8375], "silk")


def add_text(builder: Builder, name: str, text: str, position, height=1.0, rotation=0.0, face="top", color="silk"):
    """Add readable board drafting text as merged solid geometry, in mm."""
    text = text.upper()
    cell = height / 7.0
    advance = 6.0 * cell
    width = max(cell, len(text) * advance - cell)
    depth = 0.035
    meshes = []
    angle = math.radians(rotation)
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    for char_index, char in enumerate(text):
        glyph = FONT_5X7.get(char, FONT_5X7[" "])
        for row, pattern in enumerate(glyph):
            for column, enabled in enumerate(pattern):
                if enabled != "1":
                    continue
                local_x = char_index * advance + column * cell - width / 2.0
                local_y = (3.0 - row) * cell
                if face == "bottom":
                    # Mirror before placement so the legend is upright from the
                    # physical underside inspection direction.
                    local_x = -local_x
                x = position[0] + local_x * cos_a - local_y * sin_a
                y = position[1] + local_x * sin_a + local_y * cos_a
                z = 0.8375 if face == "top" else -0.8375
                pixel = trimesh.creation.box(extents=[cell * 0.78, cell * 0.78, depth])
                pixel.apply_translation([x, y, z])
                meshes.append(pixel)
    if meshes:
        builder.mesh(f"silkscreen:{face}:{name}:{text}", trimesh.util.concatenate(meshes), color)


def add_board_label_column(builder: Builder, prefix: str, labels, x: float, ys, rotation=0.0, height=0.82):
    for index, (label, y) in enumerate(zip(labels, ys)):
        add_text(builder, f"{prefix}:{index}", label.replace("GPIO", "IO"), [x, y], height, rotation)


def _segment_mesh(x1, y1, x2, y2, width, z, depth=0.025):
    length = math.hypot(x2 - x1, y2 - y1)
    if length < 0.01:
        return None
    mesh = trimesh.creation.box(extents=[length, max(width, 0.10), depth])
    transform = trimesh.transformations.rotation_matrix(math.atan2(y2 - y1, x2 - x1), [0, 0, 1])
    transform[:3, 3] = [(x1 + x2) / 2.0, (y1 + y2) / 2.0, z]
    mesh.apply_transform(transform)
    return mesh


def add_xiao_eagle_routing(builder: Builder):
    """Reproduce the official Eagle signal routing, separated by copper side."""
    brd = Path(__file__).resolve().parents[2] / "artifacts/high-fidelity-glb/2026-08-28/seeed-xiao-expansion-base-103030356/reference/Seeeduino-XIAO-Expansion-board-v1.0-200824.brd"
    root = ET.parse(brd).getroot()
    signal_root = root.find(".//signals")
    if signal_root is None:
        raise RuntimeError(f"Missing Eagle signal graph: {brd}")
    for layer, face, z in [("1", "top", 0.827), ("16", "bottom", -0.827)]:
        traces = []
        for signal in signal_root.findall("signal"):
            for wire in signal.findall("wire"):
                if wire.get("layer") != layer or wire.get("curve"):
                    continue
                traces.append(_segment_mesh(
                    float(wire.get("x1")) - 29.0,
                    float(wire.get("y1")) - 21.25,
                    float(wire.get("x2")) - 29.0,
                    float(wire.get("y2")) - 21.25,
                    max(float(wire.get("width", "0.15")), 0.12),
                    z,
                ))
        builder.mesh(f"copper:{face}:official-eagle-signal-routing", trimesh.util.concatenate([m for m in traces if m is not None]), "copper")


def generate_c3(output: Path):
    b = Builder()
    add_pcb(b, 37.0, 23.0, [(-4.75, -8.6, 2.6), (4.75, -8.6, 2.6)])
    pitch = 2.54
    ys = [(i - 3.5) * pitch for i in range(8)]
    left_labels = ["GPIO5", "GPIO6", "GPIO7", "GPIO8", "GPIO9", "GPIO10", "GPIO20", "GPIO21"]
    right_labels = ["5V", "GND", "3V3", "GPIO4", "GPIO3", "GPIO2", "GPIO1", "GPIO0"]
    add_female_row(b, "controller-left-1x8", -5.3, ys, left_labels)
    add_female_row(b, "controller-right-1x8", 5.3, ys, right_labels)
    b.marker("connector:controller-left-1x8", [-5.3, 0, 7.24])
    b.marker("connector:controller-right-1x8", [5.3, 0, 7.24])

    for side, labels, xs in [
        ("left", left_labels, [-16.0, -13.45, -10.9]),
        ("right", right_labels, [10.9, 13.45, 16.0]),
    ]:
        for y, label in zip(ys, labels):
            for lane, (x, color) in enumerate(zip(xs, ["yellow", "red", "black"] if side == "left" else ["black", "red", "yellow"]), 1):
                b.box(f"connector:{side}-breakout:{label}:insulator:{lane}", [2.25, 2.25, 2.35], [x, y, 2.0], color)
                add_male_pin(b, f"connector:{side}-breakout:{label}:pin:{lane}", x, y)
                b.cylinder(f"pad:bottom:{side}:{label}:{lane}", 0.92, 0.05, [x, y, -0.835], "gold", 16)

    b.marker("connector:gpio-breakout", [10.9, 0, 8.0])
    b.marker("anchor:c3-3v3", [16.0, ys[2], 8.0])
    b.marker("anchor:c3-gnd", [13.45, ys[1], 8.0])
    b.marker("anchor:c3-gpio0", [16.0, ys[7], 8.0])

    # Exact sold assembly features from Amazon/AliExpress reference set.
    b.box("connector:battery-jst2:body", [8.0, 6.0, 5.7], [0, 7.25, 3.65], "white")
    for x in (-1.0, 1.0):
        b.box(f"connector:battery-jst2:contact:{'positive' if x < 0 else 'negative'}", [0.45, 3.2, 0.55], [x, 7.5, 3.6], "silver")
    b.box("component:charger-ic", [3.0, 3.0, 0.8], [0.2, 0.4, 1.2], "black")
    for x, y in [(-2.4, 2.0), (2.2, 1.5), (-1.6, -2.0), (1.8, -2.2)]:
        b.box(f"component:passive:{x}:{y}", [1.2, 0.7, 0.5], [x, y, 1.05], "silver")
    # Exact visible top-side pin and rail legends from the photographed board.
    add_board_label_column(b, "c3:left-signal", ["5", "6", "7", "8", "9", "10", "20", "21"], -17.55, ys, 90, 0.78)
    add_board_label_column(b, "c3:right-signal", ["5V", "GND", "3V3", "4", "3", "2", "1", "0"], 17.45, ys, 90, 0.78)
    for name, text, x in [("vcc3", "VCC3", -15.3), ("gnd-left", "GND", -11.2), ("gnd-right", "GND", 11.2), ("vcc1", "VCC1", 15.2)]:
        add_text(b, f"c3:{name}", text, [x, -10.35], 0.72)
    add_text(b, "c3:bat-led", "BAT LED", [-2.8, 3.7], 0.66, 90)
    add_text(b, "c3:vcc", "VCC", [-2.6, -2.7], 0.76)
    add_text(b, "c3:bat", "BAT", [2.75, 3.0], 0.76, 90)
    add_text(b, "c3:3v3", "3V3", [2.75, -1.8], 0.76, 90)
    add_text(b, "c3:vcc2", "VCC2", [0.0, -6.1], 0.72)

    # The photographed reverse side exposes the battery polarity and the
    # distribution-board identity. These are geometry, not invented nets.
    add_text(b, "c3:bottom:b-positive", "B+", [-2.0, 7.6], 0.90, face="bottom")
    add_text(b, "c3:bottom:b-negative", "B-", [2.0, 7.6], 0.90, face="bottom")
    add_text(b, "c3:bottom:title", "ESP32-C3 EXPANSION BOARD", [0.0, -5.8], 0.82, face="bottom")
    b.export(output)


S3_LEFT = ["3V3A", "3V3B", "RST", "GPIO4", "GPIO5", "GPIO6", "GPIO7", "GPIO15", "GPIO16", "GPIO17", "GPIO18", "GPIO8", "GPIO3", "GPIO46", "GPIO9", "GPIO10", "GPIO11", "GPIO12", "GPIO13", "GPIO14", "5V", "GND"]
S3_RIGHT = ["GND-A", "TX", "RX", "GPIO1", "GPIO2", "GPIO42", "GPIO41", "GPIO40", "GPIO39", "GPIO38", "GPIO37", "GPIO36", "GPIO35", "GPIO0", "GPIO45", "GPIO48", "GPIO47", "GPIO21", "GPIO20", "GPIO19", "GND-B", "GND-C"]


def generate_s3(output: Path):
    b = Builder()
    add_pcb(b, 82.0, 82.0, [(-37.0, -37.0, 3.2), (37.0, -37.0, 3.2), (-37.0, 37.0, 3.2), (37.0, 37.0, 3.2)])
    pitch = 2.54
    ys = [(10.5 - i) * pitch + 8.0 for i in range(22)]
    add_female_row(b, "controller-j1-1x22", -12.7, ys, S3_LEFT, "black", 2.7)
    add_female_row(b, "controller-j3-1x22", 12.7, ys, S3_RIGHT, "black", 2.7)
    b.marker("connector:controller-j1-1x22", [-12.7, 8.0, 7.24])
    b.marker("connector:controller-j3-1x22", [12.7, 8.0, 7.24])

    for side, labels, signal_x, power_x, ground_x in [
        ("left", S3_LEFT, -20.3, -29.0, -34.0),
        ("right", S3_RIGHT, 20.3, 29.0, 34.0),
    ]:
        for y, label in zip(ys, labels):
            for lane, x, color in [("signal-inner", signal_x, "yellow"), ("signal-outer", power_x, "red"), ("ground", ground_x, "black")]:
                b.box(f"connector:{side}-breakout:{label}:{lane}:insulator", [2.25, 2.25, 2.35], [x, y, 2.0], color)
                add_male_pin(b, f"connector:{side}-breakout:{label}:{lane}:pin", x, y)
                b.cylinder(f"pad:bottom:{side}:{label}:{lane}", 0.92, 0.05, [x, y, -0.835], "gold", 16)

    b.marker("connector:gpio-breakout", [20.3, 8.0, 8.0])
    b.marker("anchor:s3-3v3", [-20.3, ys[0], 8.0])
    b.marker("anchor:s3-gnd", [20.3, ys[0], 8.0])
    b.marker("anchor:s3-gpio1", [20.3, ys[3], 8.0])

    # Dedicated 3V3 and 5V distribution headers, each 2x3.
    for bank_name, y, color in [("3v3", -22.5, "black"), ("5v", -32.0, "red")]:
        for row in range(2):
            for col in range(3):
                x = -31.5 + col * 2.54
                yy = y + row * 2.54
                b.box(f"connector:power-bank-{bank_name}:insulator:{row}:{col}", [2.25, 2.25, 2.35], [x, yy, 2.0], color)
                add_male_pin(b, f"connector:power-bank-{bank_name}:pin:{row}:{col}", x, yy)

    b.box("connector:dc-barrel-5.5x2.1:body", [13.5, 14.0, 11.0], [28.0, -34.0, 6.3], "black")
    b.cylinder("connector:dc-barrel-5.5x2.1:opening", 3.0, 0.5, [28.0, -41.1, 6.4], "dark")
    b.box("component:regulator", [8.0, 6.5, 2.0], [2.0, -33.0, 1.8], "gray")
    for index, x in enumerate((-9.5, 11.5), 1):
        b.cylinder(f"component:electrolytic-capacitor:{index}", 3.15, 7.0, [x, -32.0, 4.3], "silver")
        b.box(f"component:electrolytic-capacitor:{index}:stripe", [0.6, 5.4, 6.0], [x + 2.8, -32.0, 4.5], "black")
    # Inner controller pin map and outer duplicated signal map are both visible
    # on the reference PCB. Keeping both prevents ambiguous wiring screenshots.
    add_board_label_column(b, "s3:left-inner", S3_LEFT, -16.5, ys, 0, 0.73)
    add_board_label_column(b, "s3:left-outer", S3_LEFT, -24.6, ys, 0, 0.73)
    add_board_label_column(b, "s3:right-inner", S3_RIGHT, 16.5, ys, 0, 0.73)
    add_board_label_column(b, "s3:right-outer", S3_RIGHT, 24.6, ys, 0, 0.73)
    add_text(b, "s3:title", "ESP32-S3 GPIO EXTENSION BOARD", [0, -16.2], 1.15)
    add_text(b, "s3:revision", "V2775", [0, -19.0], 0.90)
    add_text(b, "s3:usb", "USB", [0, 1.0], 1.20)
    add_text(b, "s3:power:3v3", "3V3", [-31.5, -17.4], 1.05)
    add_text(b, "s3:power:5v", "5V", [-31.5, -27.0], 1.05)
    add_text(b, "s3:power:gnd-a", "GND", [-23.5, -22.0], 0.82, 90)
    add_text(b, "s3:power:gnd-b", "GND", [-23.5, -31.5], 0.82, 90)
    add_text(b, "s3:dc", "DC6.5-9V", [25.0, -24.4], 0.92)
    add_text(b, "s3:dc-positive", "+", [33.0, -27.0], 1.2)
    add_text(b, "s3:dc-negative", "-", [36.0, -27.0], 1.2)
    add_text(b, "s3:bottom:title", "ESP32-S3 GPIO EXTENSION BOARD", [0, -16.2], 1.05, face="bottom")
    b.export(output)


def generate_xiao(output: Path):
    b = Builder()
    holes = [(-25.0101, 17.4987, 3.0), (24.9899, 17.4987, 3.0), (24.9899, -17.5013, 3.0), (-25.0101, -17.5013, 3.0)]
    add_pcb(b, 58.0, 42.5, holes)
    add_xiao_eagle_routing(b)

    # Eagle BRD U2/J10/J11 positions, translated to the board centre.
    xs = [(-18.459 + (i - 3) * 2.54) for i in range(7)]
    low_labels = ["D0", "D1", "D2", "D3", "D4", "D5", "D6"]
    high_labels = ["USB5V", "GND", "3V3", "D10", "D9", "D8", "D7"]
    add_horizontal_socket_row(b, "xiao-lower-interface", -10.45, xs, low_labels)
    add_horizontal_socket_row(b, "xiao-lower-breakout", -7.91, xs, low_labels)
    add_horizontal_socket_row(b, "xiao-upper-interface", 10.55, xs, high_labels)
    add_horizontal_socket_row(b, "xiao-upper-breakout", 8.01, xs, high_labels)
    b.marker("connector:xiao-controller-socket", [-18.459, 0.05, 4.18])
    b.marker("anchor:xiao-3v3", [xs[2], 10.55, 4.18])
    b.marker("anchor:xiao-gnd", [xs[1], 10.55, 4.18])
    b.marker("anchor:xiao-d0", [xs[0], -10.45, 4.18])

    # OLED U6 is 24.74 x 16.9 mm at exact Eagle placement (34.8,21.25).
    b.box("component:oled:pcb", [24.74, 16.9, 1.1], [5.8, 0, 1.35], "blue")
    b.box("component:oled:display", [22.2, 11.8, 1.25], [5.8, 0, 2.53], "dark")

    # Grove J1/J4/J5/J6 exact Eagle centres translated from the board origin.
    grove = [
        ("i2c-a", 11.6, 12.55, ["SCL5", "SDA4", "3V3", "GND"]),
        ("i2c-b", 0.0, 12.55, ["SCL5", "SDA4", "3V3", "GND"]),
        ("a0-d0", 0.0, -12.45, ["GND", "3V3", "NC", "D0"]),
        ("uart", 11.6, -12.45, ["GND", "3V3", "TX16", "RX17"]),
    ]
    for name, x, y, contact_labels in grove:
        b.box(f"connector:grove-{name}:body", [8.4, 5.9, 5.2], [x, y, 3.4], "white")
        for pin, dx in zip(contact_labels, [-3.0, -1.0, 1.0, 3.0]):
            b.box(f"connector:grove-{name}:contact:{pin}", [0.42, 3.0, 0.42], [x + dx, y, 3.4], "silver")
        b.marker(f"connector:grove-{name}", [x, y, 3.4])
    b.marker("anchor:xiao-grove-a0-gnd", [-3.0, -12.45, 3.4])
    b.marker("anchor:xiao-grove-a0-3v3", [-1.0, -12.45, 3.4])
    b.marker("anchor:xiao-grove-a0-d0", [3.0, -12.45, 3.4])

    # J7 2x4 5V servo/sensor header at Eagle centre (52.578,21.971).
    for row in range(2):
        for col, label in enumerate(["SWDIO-or-GND", "3V3-or-5V", "SWCLK-or-GND", "RST-or-5V"]):
            x = 23.578 + (row - 0.5) * 2.54
            y = 0.721 + (col - 1.5) * 2.54
            b.box(f"connector:servo-swd-2x4:insulator:{row}:{label}", [2.25, 2.25, 2.35], [x, y, 2.0], "black")
            add_male_pin(b, f"connector:servo-swd-2x4:pin:{row}:{label}", x, y)

    # JST2.0 LiPo, buttons, buzzer, switch, RTC and simplified PMIC revision.
    b.box("connector:lipo-jst2:body", [6.0, 8.0, 5.0], [24.6, -10.314, 3.3], "white")
    for x in (23.6, 25.6):
        b.box(f"connector:lipo-jst2:contact:{x}", [0.5, 3.2, 0.5], [x, -10.314, 3.3], "silver")
    b.box("component:power-switch", [9.0, 3.5, 3.2], [-14.014, 17.866, 2.4], "gray")
    b.box("component:reset-button", [4.5, 3.8, 1.8], [-19.985, -19.853, 1.7], "silver")
    b.box("component:user-button", [4.5, 3.8, 1.8], [20.022, -19.853, 1.7], "silver")
    b.box("component:buzzer", [5.0, 5.0, 2.5], [-11.978, -18.493, 2.05], "black")
    b.box("component:rtc-pcf8563", [5.0, 3.9, 1.2], [22.238, 11.517, 1.4], "black")
    b.box("component:pmic-sy6974b-revision", [4.0, 4.0, 0.8], [-17.249, 2.205, 1.2], "black")
    for side, dx, dy in [("left", -2.15, 0), ("right", 2.15, 0), ("top", 0, 2.15), ("bottom", 0, -2.15)]:
        for index in range(5):
            offset = (index - 2) * 0.65
            px, py = (-17.249 + dx + (offset if dy else 0), 2.205 + dy + (offset if dx else 0))
            b.box(f"component:pmic-sy6974b-revision:lead:{side}:{index}", [0.42 if dx else 0.28, 0.28 if dx else 0.42, 0.16], [px, py, 1.0], "silver")

    # Back-side components from exact Eagle placements.
    b.box("connector:microsd-slot:body", [16.1, 14.5, 1.85], [13.8, -0.05, -1.725], "silver")
    b.cylinder("component:rtc-cr1220-holder", 7.0, 1.8, [-0.4, -0.05, -1.7], "silver")
    # Reference-exact controller pin labels.
    for index, (label, x) in enumerate(zip(low_labels, xs)):
        printed = label[1:] if label.startswith("D") else label
        add_text(b, f"xiao:lower:{index}", printed, [x, -12.65], 0.72, 90)
    for index, (label, x) in enumerate(zip(high_labels, xs)):
        printed = label[1:] if label.startswith("D") else label
        add_text(b, f"xiao:upper:{index}", printed, [x, 12.7], 0.72, 90)

    # Grove, SWD/servo, button, RTC and power legends reproduced from the
    # official top-layout and pinout sheets.
    label_specs = [
        ("iic-a", "SCL5 SDA4 3V3 GND", [11.6, 16.0], 0.58, 0),
        ("iic-b", "SCL5 SDA4 3V3 GND", [0.0, 16.0], 0.58, 0),
        ("a0", "GND 3V3 N/A 0", [0.0, -16.0], 0.58, 0),
        ("uart", "GND 3V3 TX16 RX17", [11.6, -16.0], 0.58, 0),
        ("reset", "RESET", [-24.0, -16.7], 0.74, 90),
        ("buzzer", "BUZZER(A3)", [-10.7, -14.8], 0.62, 90),
        ("button", "BUTTON(D1)", [17.1, -15.0], 0.62, 90),
        ("rtc", "RTC", [23.0, 15.2], 0.82, 0),
        ("iic", "IIC", [5.8, 18.5], 0.82, 0),
        ("switch", "OFF/ON", [-14.0, 14.8], 0.70, 0),
        ("swd", "SWCLK SWDIO 3V3 GND", [20.2, 5.2], 0.54, 90),
        ("servo", "RX17 TX16 5V GND", [26.2, 5.2], 0.54, 90),
    ]
    for name, text, position, height, rotation in label_specs:
        add_text(b, f"xiao:{name}", text, position, height, rotation)
    add_text(b, "xiao:bottom:title", "SEEEDUINO XIAO EXPANSION BOARD", [7.0, -17.2], 0.84, face="bottom")
    add_text(b, "xiao:bottom:sd", "MICRO SD", [13.8, 8.8], 0.82, face="bottom")
    add_text(b, "xiao:bottom:rtc", "RTC CR1220", [-0.4, 9.0], 0.76, face="bottom")
    b.export(output)


GENERATORS = {
    "aitrip-esp32-c3-supermini-expansion-board-b0fbgfwfb1": generate_c3,
    "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx": generate_s3,
    "seeed-xiao-expansion-base-103030356": generate_xiao,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("part_id", choices=sorted(GENERATORS))
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    GENERATORS[args.part_id](args.output)


if __name__ == "__main__":
    main()
