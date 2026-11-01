"""A drawing of a design's insides, with every wire in its own compiler colour and the plugs dark, for looking at the routing by eye."""
import json
import sys
from pathlib import Path

import numpy as np
import pyvista as pv
import trimesh

from card import build_card, load_nodes
from parts import ensure_part

COLOURS = {"PRINT_Shell": "#8fb39a", "PRINT_Base": "#c98f6b", "PRINT_Carrier": "#e4dccb"}
PART_COLOURS = ["#1f5f46", "#2f6fb4", "#7a5ea8"]


def wire_parts(design, transforms):
    if len(design["purchased"]) < 2:
        return [], []
    import wiring_checks as w
    ids = list(transforms)
    controller = next(i for i in ids if build_card(i).get("role") == "controller")
    compiled = w.wires_for([controller] + [i for i in ids if i != controller])
    colours = w.wire_colours(compiled)
    plugs = [w.plug_box(w.plug_local(end), transforms[end["part_id"]]) for wire in compiled for end in (wire["from"], wire["to"])]
    wires = []
    for wire in design.get("wires") or []:
        path = np.array(wire["path"], dtype=float)
        pieces = [trimesh.creation.cylinder(radius=w.WIRE_RADIUS, segment=(a, b), sections=12) for a, b in zip(path[:-1], path[1:]) if np.linalg.norm(b - a) > 1e-6]
        if pieces:
            wires.append((trimesh.util.concatenate(pieces), str(colours.get(wire["net"], "#c0392b"))))
    return plugs, wires


def render(folder, out=None):
    folder = Path(folder)
    design = json.loads((folder / "design.json").read_text(encoding="utf-8"))
    printed = {n: trimesh.load_mesh(folder / f) for n, f in design["print"].items()}
    transforms = {p["part_id"]: np.array(p["transform"], dtype=float) for p in design["purchased"].values()}
    inside = []
    for index, (part_id, transform) in enumerate(transforms.items()):
        mesh = trimesh.util.concatenate(list(load_nodes(ensure_part(part_id)).values()))
        mesh.apply_transform(transform)
        inside.append((mesh, PART_COLOURS[index % len(PART_COLOURS)]))
    plugs, wires = wire_parts(design, transforms)
    if plugs:
        inside.append((trimesh.util.concatenate(plugs), "#23262b"))
    inside.extend(wires)
    union = trimesh.util.concatenate(list(printed.values()))
    center = (union.bounds[0] + union.bounds[1]) / 2
    span = (union.bounds[1] - union.bounds[0]).max()
    colour_of = lambda name: COLOURS.get(name, "#a9b4bd")

    plot = pv.Plotter(off_screen=True, shape=(2, 3), window_size=(1800, 1100))

    def camera(direction, up=(0, 0, 1), distance=2.2):
        plot.camera_position = [tuple(center + np.array(direction, dtype=float) * span * distance), tuple(center), up]

    plot.subplot(0, 0)
    plot.add_text("inside, Shell and Base hidden", font_size=10)
    if "PRINT_Carrier" in printed:
        plot.add_mesh(pv.wrap(printed["PRINT_Carrier"]), color=COLOURS["PRINT_Carrier"])
    for mesh, colour in inside:
        plot.add_mesh(pv.wrap(mesh), color=colour)
    camera((0.8, 1.4, 0.7), distance=1.3)

    plot.subplot(0, 1)
    plot.add_text("outside, from the front", font_size=10)
    for name, mesh in printed.items():
        plot.add_mesh(pv.wrap(mesh), color=colour_of(name))
    for mesh, colour in inside:
        plot.add_mesh(pv.wrap(mesh), color=colour)
    camera((0.6, -1.4, 0.8), distance=1.4)

    plot.subplot(0, 2)
    plot.add_text("outside, from behind", font_size=10)
    for name, mesh in printed.items():
        plot.add_mesh(pv.wrap(mesh), color=colour_of(name))
    for mesh, colour in inside:
        plot.add_mesh(pv.wrap(mesh), color=colour)
    camera((-0.7, 1.4, 0.7), distance=1.4)

    cuts = [("cut left-right, through the middle", (1, 0, 0), center, (1, 0, 0), (0, 0, 1)), ("cut top-down, through the middle", (0, 0, 1), center, (0, 0, 1), (0, 1, 0)), ("cut front-back, through the middle", (0, 1, 0), center, (0, 1, 0), (0, 0, 1))]
    for index, (label, normal, origin, view, up) in enumerate(cuts):
        plot.subplot(1, index)
        plot.add_text(label, font_size=10)
        for name, mesh in printed.items():
            clipped = pv.wrap(mesh).clip(normal=normal, origin=origin)
            if clipped.n_points:
                plot.add_mesh(clipped, color=colour_of(name))
        for mesh, colour in inside:
            clipped = pv.wrap(mesh).clip(normal=normal, origin=origin)
            if clipped.n_points:
                plot.add_mesh(clipped, color=colour)
        camera(view, up, distance=1.5)
    out = Path(out or folder / "inspect.png")
    plot.screenshot(str(out))
    return out


if __name__ == "__main__":
    print(render(sys.argv[1]))
