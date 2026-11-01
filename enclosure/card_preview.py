"""Draws a part with its card's boxes from front, back and side, for the one-time human review of a new card."""
import sys
from pathlib import Path

import numpy as np
import pyvista as pv

from card import build_card, load_nodes
from parts import ensure_part

COLORS = {"screen": "lime", "glass": "cyan", "usb": "red", "pin_rows": "orange", "corner_posts": "magenta", "pcb": "yellow", "frame": "white"}
VIEWS = {"front": (0, 0, 1), "back": (0, 0, -1), "usb end": (0, -1, 0.15), "side": (1, 0, 0.15)}


def render(part_id):
    card = build_card(part_id)
    merged = pv.merge([pv.wrap(m) for m in load_nodes(ensure_part(part_id)).values()])
    plotter = pv.Plotter(off_screen=True, shape=(1, len(VIEWS)), window_size=(1800, 700))
    center = (np.array(card["envelope"]["min"]) + np.array(card["envelope"]["max"])) / 2
    span = max(card["envelope"]["size"])
    for i, (label, direction) in enumerate(VIEWS.items()):
        plotter.subplot(0, i)
        plotter.add_text(label, font_size=11)
        plotter.add_mesh(merged, color="#9aa0a6", opacity=0.55)
        for name, feature in card["features"].items():
            lo, hi = np.array(feature["min"]), np.array(feature["max"])
            hi = np.maximum(hi, lo + 0.02)
            bounds = (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2])
            plotter.add_mesh(pv.Box(bounds), color=COLORS.get(name, "blue"), style="wireframe", line_width=3, label=name)
        if i == 0:
            plotter.add_legend(size=(0.45, 0.35), bcolor="black")
        d = np.array(direction, dtype=float)
        plotter.camera_position = [tuple(center + d * span * 2.4), tuple(center), (0, 1, 0) if abs(d[2]) > 0.9 else (0, 0, 1)]
    out = Path(__file__).resolve().parent / "runs" / "cards" / f"{part_id}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    plotter.screenshot(str(out))
    return out


if __name__ == "__main__":
    print(render(sys.argv[1]))
