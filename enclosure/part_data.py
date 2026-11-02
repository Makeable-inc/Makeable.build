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
