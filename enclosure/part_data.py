"""Writes parts_data.json, the real part sizes the case_parts library reads inside a design script. Nothing here calls an AI."""
import json
from pathlib import Path

from card import build_card, load_nodes
from checks import PLUG_ROOM
from parts import ensure_part
from wiring_checks import plug_local, wires_for


def part_names(part_ids):
    return {part_id: ("PURCHASE_Board" if index == 0 else f"PURCHASE_Part{index + 1}") for index, part_id in enumerate(part_ids)}


def solids_of(part_id):
    """A box for every solid in the model, because a small component can still hit plastic."""
    boxes = []
    for mesh in load_nodes(ensure_part(part_id)).values():
        size = mesh.bounds[1] - mesh.bounds[0]
        if size.max() >= 0.3:
            boxes.append([[round(float(v), 3) for v in mesh.bounds[0]], [round(float(v), 3) for v in mesh.bounds[1]]])
    return boxes


def build_data(part_ids):
    names = part_names(part_ids)
    parts = {}
    for part_id, name in names.items():
        card = build_card(part_id)
        parts[name] = {"part_id": part_id, "role": card["role"], "front": card["front"], "envelope": card["envelope"], "features": card["features"], "buttons": card["buttons"], "solids": solids_of(part_id)}
    wires = []
    if len(part_ids) > 1:
        for wire in wires_for(part_ids):
            ends = {}
            for key in ("from", "to"):
                plug = plug_local(wire[key])
                ends[key] = {"name": names[wire[key]["part_id"]], "label": wire[key]["label"], "start": [round(float(v), 3) for v in plug["start"]], "back": [round(float(v), 3) for v in plug["back"]], "normal": [round(float(v), 3) for v in plug["normal"]]}
            wires.append({"net": wire["net"], **ends})
    return {"parts": parts, "wires": wires, "plug_room": PLUG_ROOM}


def write_data(part_ids, folder):
    path = Path(folder) / "parts_data.json"
    path.write_text(json.dumps(build_data(part_ids)), encoding="utf-8")
    return path


def inside_depth(part_id, card):
    """How deep the part goes along its own front axis, without the knob and shaft that stay outside the case."""
    axis = "xyz".index(card["front"][1])
    skip = [card["features"][n] for n in ("knob", "shaft", "bushing") if n in card["features"]]
    kept = []
    for low, high in solids_of(part_id):
        if not any(all(f["min"][i] - 0.01 <= low[i] and high[i] <= f["max"][i] + 0.01 for i in range(3)) for f in skip):
            kept.append((low[axis], high[axis]))
    return max(k[1] for k in kept) - min(k[0] for k in kept)


def required_space(part_ids):
    """The smallest body these parts can fit in, before any AI call: the front parts side by side, a controller behind them. It assumes the layout the library builds, so it is a starting limit and not a guarantee."""
    from case_parts import COVER_THICKNESS, HOLDER_WALL, MIN_WALL, POST_RADIUS
    plug_past_pin = 8.0
    wire_room = 10.0
    cards = [build_card(p) for p in part_ids]
    has_own_screen = "screen" in cards[0]["features"]
    front_ids = part_ids if has_own_screen else part_ids[1:]
    widths, heights, stacks = [], [], []
    for part_id in front_ids:
        card = build_card(part_id)
        long, short = sorted(card["features"]["pcb"]["size"], reverse=True)[:2]
        screen = card["features"].get("screen")
        if screen and abs(screen["size"][0] - screen["size"][1]) > 1.0:
            # A wide screen lies landscape, so the board's long side runs across the case.
            widths.append(long)
            heights.append(short)
        else:
            # A square screen or another part can turn its short side across the case.
            widths.append(short)
            heights.append(long)
        stacks.append(inside_depth(part_id, card) + plug_past_pin)
    width = sum(widths) + 2 * MIN_WALL + 3.0 * (len(front_ids) - 1)
    height = max(heights) + 2 * MIN_WALL + 2 * POST_RADIUS + 1.0
    depth = max(stacks)
    if not has_own_screen:
        controller = sorted(cards[0]["features"]["pcb"]["size"], reverse=True)
        height = max(height, controller[1] + 2 * (HOLDER_WALL + MIN_WALL) + 0.3)
        depth = max(depth, inside_depth(part_ids[0], cards[0]) + plug_past_pin + 4.0)
    return {"width": round(width + 1), "height": round(height + 0.5), "depth": round(depth + MIN_WALL + COVER_THICKNESS + wire_room)}


def space_conflict(base, space, limits):
    """Why these parts cannot fit this design, found before any paid AI call, or None. The agent can use this to offer the user options."""
    problems = []
    if space["width"] > limits["max_width"]:
        problems.append(f"the parts need {space['width']} mm of width and the screen-size rule allows {limits['max_width']:.0f} mm")
    if space["height"] > limits["max_height"]:
        problems.append(f"the parts need {space['height']} mm of height and the screen-size rule allows {limits['max_height']:.0f} mm")
    if space["depth"] > base["max_depth"]:
        problems.append(f"the parts need {space['depth']} mm of depth and the design allows {base['max_depth']} mm")
    if space["width"] > limits["tight_width"] and space["height"] > limits["tight_height"]:
        problems.append(f"the front must be at most {limits['tight_width']:.0f} mm wide or {limits['tight_height']:.0f} mm tall, and the parts need {space['width']} x {space['height']} mm")
    low, high = base["width_to_height"]
    if space["width"] / high > space["height"] and space["height"] * high < space["width"]:
        problems.append(f"the parts need a front {space['width']} mm wide, which is wider than a width / height of {high} allows at {space['height']} mm tall")
    return "; ".join(problems) or None
