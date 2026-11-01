"""Draws a design folder from several angles, with its purchased parts in place, so a person can look at the real files."""
import json
import sys
from pathlib import Path

import numpy as np
import pyvista as pv
import trimesh

from card import load_nodes
from parts import ensure_part

COLORS = ["#d9d2c5", "#8fb39a", "#c98f6b", "#8f9fc4"]
VIEWS = {"front": (0.5, -1, 0.35), "straight on": (0, -1, 0.02), "side": (1, -0.2, 0.2), "back": (-0.5, 1, 0.35)}


def render(folder, out=None, explode=0.0):
    folder = Path(folder)
    design = json.loads((folder / "design.json").read_text(encoding="utf-8"))
    actors = []
    for i, (name, filename) in enumerate(design["print"].items()):
        mesh = trimesh.load_mesh(folder / filename)
        actors.append((pv.wrap(mesh).translate((0, 0, explode * i)), COLORS[i % len(COLORS)], 1.0))
    for part in design["purchased"].values():
        merged = trimesh.util.concatenate(list(load_nodes(ensure_part(part["part_id"])).values()))
        merged.apply_transform(np.array(part["transform"], dtype=float))
        actors.append((pv.wrap(merged), "#2f6f4f", 1.0))
    bounds = np.array([a[0].bounds for a in actors])
    low = bounds[:, [0, 2, 4]].min(axis=0)
    high = bounds[:, [1, 3, 5]].max(axis=0)
    center, span = (low + high) / 2, (high - low).max()
    plotter = pv.Plotter(off_screen=True, shape=(1, len(VIEWS)), window_size=(1800, 600))
    for i, (label, direction) in enumerate(VIEWS.items()):
        plotter.subplot(0, i)
        plotter.add_text(label, font_size=11)
        for mesh, color, opacity in actors:
            plotter.add_mesh(mesh, color=color, opacity=opacity, smooth_shading=True, split_sharp_edges=True, feature_angle=30)
        d = np.array(direction, dtype=float)
        d /= np.linalg.norm(d)
        plotter.camera_position = [tuple(center + d * span * 3.2), tuple(center), (0, 1, 0) if abs(d[2]) > 0.95 else (0, 0, 1)]
    out = Path(out or folder / "preview.png")
    plotter.screenshot(str(out))
    return out


if __name__ == "__main__":
    print(render(sys.argv[1], explode=float(sys.argv[2]) if len(sys.argv) > 2 else 0.0))
