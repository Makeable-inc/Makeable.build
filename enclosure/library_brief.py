"""The brief for a case built from case_parts. The AI designs where things go and can adapt or add pieces; the library handles sizes and the build order."""
import json
from pathlib import Path

from card import build_card
from checks import PLUG_ROOM
from wiring_checks import FINGER_MAX_DEPTH, plug_local, wires_for

HERE = Path(__file__).resolve().parent

LIBRARY_SYSTEM = """You design the inside of a 3D-printed electronics case by writing one complete Python script using build123d 0.13 and the tested library case_parts. Reply with only the script, in one ```python block. Allowed imports: build123d, math, json, pathlib, case_parts.

Use the library for everything it offers. Its pieces read the real part sizes and already keep the safe gaps, thicknesses and straight paths, so you rarely need to type a size. You can pass different arguments to adapt a piece. If a real need has no piece, write your own with block() and along_y(), and the same fixed checks measure the result. When a piece raises an error, read it and change your layout. Do not work around it.

The library, all in millimetres, with the screen facing -y and the rear cover closing from +y:
- Part(data, name, faces, up, local_up, at, anchor): places a real part. Its front turns to face `faces`, its local_up axis turns to `up`, and the centre of feature `anchor` lands on `at`. part.feature(name) gives its world box.
- split(body, seam_y): the Shell blank and the flat cover.
- deepest_front(body, x0, x1, z0, z1), front_surface(body, x, z): the outside of a curved front at that spot.
- pocket(part, to_y, data): the room for a part in the Shell, including its plugs. It only widens toward the back.
- window(part), shaft_hole(part), knob_recess(part, depth_from_y), touch_opening(part), usb_opening(part, data): fitted openings. Cut usb_opening from every printed part.
- tower(part, cover_y), tower_room(part, to_y): a holder for a small controller, built into the cover, and the room it needs in the Shell.
- stop(part, x, z, cover_y, clear_of=[...]): a column from the cover to just behind a part. It thickens when long. Put stops behind boards that have no other support, and one behind a knob so pressing it pushes against plastic.
- Screw(x, z, back_y, seam_y, parts=[...], towers=[...]): has post(), shell_cut(), cover_cut() and entry(). It refuses a post in a part's path.
- wire_paths(data, parts, lane_y): guide paths for the wires.
- finish(shell, cover, screen_and_inputs, controller, screws, wires, glued=[...], holder=..., insert_from=...): checks each part is one solid, exports it and writes design.json. For a controller with its own screen, pass holder="PRINT_Shell", insert_from="+y", and do not build a tower.
- one_solid, block, along_y, joined, load_data, and the constants GAP, MIN_WALL, COVER_THICKNESS and SEAM_GAP.

How the case works:
- BODY.step is the decided outer form, and its back is flat. Load it, and do not rebuild it or add anything outside it.
- Parts go in the Shell, with their faces just behind the front wall. The cover holds a small controller on its tower and closes from the back.
- The first thing to decide is where each part goes. Parts must fit inside the body with at least MIN_WALL of plastic around them.
- Everything behind a part in the Shell must stay out of its outline, or the Shell cannot close over it. pocket() and Screw() take care of this if you use them.
- Glue is allowed only for a board sitting in its holder or pocket. Never mark a part you press, such as a knob, as glued.
- Keep the script short. It should read like the example."""


def compact_card(part_id):
    card = build_card(part_id)
    keep = {name: {k: feature[k] for k in ("min", "max", "size", "opens_toward", "points", "may_face_out", "note", "estimate") if k in feature} for name, feature in card["features"].items()}
    return {"part_id": part_id, "role": card["role"], "front": card["front"], "pins_point": card.get("pins_point"), "envelope": card["envelope"], "features": keep}


def wire_lines(part_ids):
    if len(part_ids) < 2:
        return []
    names = {p: ("PURCHASE_Board" if i == 0 else f"PURCHASE_Part{i + 1}") for i, p in enumerate(part_ids)}
    lines = []
    for wire in wires_for(part_ids):
        ends = []
        for key in ("from", "to"):
            plug = plug_local(wire[key])
            ends.append(f"{names[wire[key]['part_id']]} {wire[key]['label']}, pointing {plug['normal'].tolist()} in its own coordinates")
        lines.append(f"{wire['net']}: " + " to ".join(ends))
    return lines


def library_brief(part_ids, frozen_body_note):
    example = (HERE / "case_example.py").read_text(encoding="utf-8")
    names = {p: ("PURCHASE_Board" if i == 0 else f"PURCHASE_Part{i + 1}") for i, p in enumerate(part_ids)}
    parts = "\n".join(f"{names[p]}: {json.dumps(compact_card(p))}" for p in part_ids)
    wires = "\n".join(wire_lines(part_ids))
    return f"""{frozen_body_note}

The real parts, measured from their models. parts_data.json holds the same sizes for the library:
{parts}

The wires, which come from the electrical compiler and cannot change. Every plug needs room, so keep each part's plugs inside the case. Real jumpers are floppy, so they can be bundled into any open space:
{wires}

USB plug room: {json.dumps(PLUG_ROOM)}. A touch opening must be at most {FINGER_MAX_DEPTH} mm deep from the sensor's face to the outside.

A complete working example, for a controller, a separate screen and a knob. Adapt it to these parts and to this body. Do not copy its numbers blindly, because your body and parts differ:
```python
{example}```"""
