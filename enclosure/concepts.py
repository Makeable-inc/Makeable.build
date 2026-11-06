"""Concept picture for a case. The screen's shape comes from the part card, and results are saved so a repeat costs nothing."""
import base64
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np

from agent import api_key
from card import build_card

HERE = Path(__file__).resolve().parent
FOLDER = HERE / "runs" / "concepts"
MODEL = "gpt-image-2"
TEMPLATE = ("Product concept render of a small 3D-printable desk device, seen from the front and slightly to one side. The look: {look}. "
            "The one working feature on the front is a single flat rectangular screen, {wide} mm wide and {tall} mm tall, with its long side {orientation}. "
            "The screen is the main feature and spans at least half of the front's width, inside a slim even bezel. The whole device is only about {case_wide} mm wide, so it is compact and chunky. "
            "One matte plastic colour with a dark screen, showing a simple friendly picture. Soft studio light, plain light background. "
            "A simple solid one-piece body with a flat bottom and softened edges, no thin parts, no text, no logos, no fake buttons, and no cables.")


def picture_prompt(part_id, look, landscape=True):
    size = build_card(part_id)["features"]["screen"]["size"]
    short, long = sorted(size[:2])
    wide, tall = (long, short) if landscape else (short, long)
    return TEMPLATE.format(look=look, wide=round(wide), tall=round(tall), orientation="horizontal" if landscape else "vertical", case_wide=round(wide / 0.6))


def concept(part_id, look, landscape=True):
    return generate(picture_prompt(part_id, look, landscape))


def base_picture(base):
    """The text-only concept (the live one-shot pipeline uses this). The agents use layout_picture instead."""
    return generate(base["picture_prompt"])


def agent_picture(base):
    """The concept for an agent run: drawn from the real parts, unless the design asks for the text-only picture with
    "concept": "text" (the frozen test designs' first pictures were made that way)."""
    if base.get("concept") == "text" or not base.get("look"):
        return base_picture(base)
    return layout_picture(base)


def generate(prompt):
    path = FOLDER / f"{hashlib.sha256((MODEL + prompt).encode()).hexdigest()[:12]}.png"
    if path.exists():
        return path
    FOLDER.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"model": MODEL, "prompt": prompt, "size": "1024x1024", "quality": "medium", "n": 1}).encode()
    request = urllib.request.Request("https://api.openai.com/v1/images/generations", data=body, headers={"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=300) as response:
        data = json.load(response)
    path.write_bytes(base64.b64decode(data["data"][0]["b64_json"]))
    path.with_suffix(".json").write_text(json.dumps({"prompt": prompt, "model": MODEL, "usage": data.get("usage")}, indent=1), encoding="utf-8")
    return path


# ---------- the concept drawn from the real parts ----------
# A picture drawn from text alone does not know the parts: it can ask for a tall body the screen-size rule forbids, or
# put the screen where it cannot go. This draws a plain block at the real room's size, with the screen and the knob or
# touch button at their real size and place, and asks the image model to turn that block into the character, keeping
# them. The agents and reviewers then aim at a body the rules can pass.

LAYOUT_PROMPT = (
    "This is a plain block holding the real parts of a small 3D-printable desk device, drawn at their real size and "
    "place: the dark rectangle is its screen{input}. Redesign the block's outside as {look}. Keep the screen{keep} exactly "
    "where they are and the same size, and keep the body's overall width, height and depth within about {slack}% of the "
    "block, because the parts need that room. Put the character into the body's shape and its edges, and add features "
    "on the top, the sides and the bottom corners. Use big, smooth forms a 3D printer can make: no stripes, "
    "grooves, vents, grilles or other fine surface detail. Same viewpoint. Product concept render, one matte plastic colour, "
    "dark screen, soft studio light, plain light background, no text, no logos, no cables, no other buttons.")
EXTRA = 8.0   # mm of room shown beyond the parts' room on each axis (never past the face limits)


def front_parts(part_ids):
    """The parts seen on the front, left to right as the parts' room is worked out: (part_id, card)."""
    cards = [build_card(p) for p in part_ids]
    own = "screen" in cards[0]["features"]
    return [(p, c) for p, c in zip(part_ids, cards)][0 if own else 1:]


def layout_block(base):
    """The plain block and the real front parts on it, as trimesh meshes: (block, [(mesh, colour)])."""
    import trimesh
    from part_data import required_space
    from review_facts import screen_limits
    room = required_space(base["parts"].split(","))
    try:
        limit = screen_limits(base)
    except Exception:
        limit = None
    w, h, d = room["width"] + EXTRA, room["height"] + EXTRA, min(room["depth"] + EXTRA, base.get("max_depth", 1e9))
    if limit:
        # stay within the face limits: one of the two face shapes the parts fit into
        if room["height"] <= limit["tight_height"]:
            w, h = min(w, limit["max_width"]), min(h, limit["tight_height"])
        else:
            w, h = min(w, limit["tight_width"]), min(h, limit["max_height"])
    block = trimesh.creation.box(extents=(w, d, h), transform=trimesh.transformations.translation_matrix((0, 0, h / 2)))
    front = -d / 2
    shown, widths = [], []
    parts = front_parts(base["parts"].split(","))
    for _, card in parts:
        long, short = sorted(card["features"]["pcb"]["size"], reverse=True)[:2]
        screen = card["features"].get("screen")
        widths.append(long if screen and abs(screen["size"][0] - screen["size"][1]) > 1.0 else short)
    total = sum(widths) + 3.0 * (len(widths) - 1)
    x = -total / 2
    for (part_id, card), width in zip(parts, widths):
        f = card["features"]
        cx = x + width / 2
        x += width + 3.0
        if "screen" in f:
            a, b = sorted(f["screen"]["size"][:2], reverse=True)
            mesh = trimesh.creation.box(extents=(a, 0.6, b), transform=trimesh.transformations.translation_matrix((cx, front - 0.25, h / 2)))
            shown.append((mesh, "#1d1f22"))
        elif "knob" in f:
            r, length = f["knob"]["size"][0] / 2, 9.0
            mesh = trimesh.creation.cylinder(radius=r, height=length, sections=48)
            mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, (1, 0, 0)))
            mesh.apply_translation((cx, front - length / 2, h / 2))
            shown.append((mesh, "#3a3c40"))
        elif "touch" in f:
            r = max(f["touch"]["size"][:2]) / 2 + 1.0
            mesh = trimesh.creation.cylinder(radius=r, height=0.6, sections=48)
            mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, (1, 0, 0)))
            mesh.apply_translation((cx, front - 0.25, h / 2))
            shown.append((mesh, "#8b857a"))
    return block, shown


def layout_render(base, out):
    """The plain block with its real front parts, from the concept pictures' usual three-quarter view."""
    import pyvista as pv
    block, shown = layout_block(base)
    plotter = pv.Plotter(off_screen=True, window_size=(1024, 1024))
    plotter.set_background("#f2efe9")
    plotter.add_mesh(pv.wrap(block), color="#e6dfd2", smooth_shading=False, ambient=0.3, diffuse=0.75)
    for mesh, colour in shown:
        plotter.add_mesh(pv.wrap(mesh), color=colour, smooth_shading=True, ambient=0.3)
    centre = block.bounds.mean(axis=0)
    span = (block.bounds[1] - block.bounds[0]).max()
    view = np.array([0.45, -1.0, 0.35])
    view /= np.linalg.norm(view)
    plotter.camera_position = [tuple(centre + view * span * 2.6), tuple(centre), (0, 0, 1)]
    plotter.screenshot(str(out))
    plotter.close()
    return Path(out)


def layout_picture(base, slack=10):
    """The concept for this design, drawn from its real parts (cached: a repeat costs nothing)."""
    FOLDER.mkdir(parents=True, exist_ok=True)
    kinds = [("knob" if "knob" in c["features"] else "touch" if "touch" in c["features"] else None)
             for _, c in front_parts(base["parts"].split(","))]
    has = [k for k in kinds if k]
    words = {"knob": "the round knob", "touch": "the round touch button"}
    prompt = LAYOUT_PROMPT.format(look=base["look"], slack=slack,
                                  input="".join(f", and the {'round knob' if k == 'knob' else 'grey disc is its round touch button'}" for k in has),
                                  keep="".join(f" and {words[k]}" for k in has))
    render = layout_render(base, FOLDER / "layout-tmp.png")
    key = hashlib.sha256(render.read_bytes() + (MODEL + prompt).encode()).hexdigest()[:12]
    out = FOLDER / f"layout-{key}.png"
    keep_render = FOLDER / f"layout-{key}-block.png"
    render.replace(keep_render)
    if out.exists():
        return out
    out.write_bytes(edit(keep_render, prompt))
    out.with_suffix(".json").write_text(json.dumps({"prompt": prompt, "model": MODEL, "block": keep_render.name}, indent=1), encoding="utf-8")
    return out


def edit(image, prompt):
    """One image edit: the picture redrawn as the prompt says. Returns PNG bytes."""
    import uuid
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{MODEL}\r\n'.encode(),
             f'--{boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n{prompt}\r\n'.encode(),
             f'--{boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1024\r\n'.encode(),
             f'--{boundary}\r\nContent-Disposition: form-data; name="quality"\r\n\r\nmedium\r\n'.encode(),
             f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="block.png"\r\nContent-Type: image/png\r\n\r\n'.encode()
             + Path(image).read_bytes() + b"\r\n",
             f"--{boundary}--\r\n".encode()]
    request = urllib.request.Request("https://api.openai.com/v1/images/edits", data=b"".join(parts),
                                     headers={"Authorization": f"Bearer {api_key()}", "Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(request, timeout=300) as response:
        data = json.load(response)
    return base64.b64decode(data["data"][0]["b64_json"])

if __name__ == "__main__":
    print(concept(sys.argv[1], sys.argv[2]))
