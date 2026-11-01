"""Body first: the AI designs only the outer shape, looks at a render next to the concept picture, and revises. The result is frozen before any engineering starts."""
import json
import shutil
import time
from pathlib import Path

import numpy as np
import pyvista as pv
import trimesh

import agent
from card import build_card
from case_checks import MIN_SCREEN_SHARE_OTHER, MIN_SCREEN_SHARE_WIDEST
from checks import load_stl, unsealed_result
from look_check import look_check
from sandbox import run_design

MAX_BODY_TRIES = 3
GOOD_ENOUGH_SCORE = 8
VIEWS = {"front": (0.5, -1, 0.35), "straight on": (0, -1, 0.02), "side": (1, -0.2, 0.2), "back": (-0.5, 1, 0.35)}

BODY_SYSTEM = """You are an industrial designer who models in code. Write one complete Python script using build123d 0.13. Reply with only the script, in one ```python block. Allowed imports: build123d, math, json, pathlib.

The script writes one file, BODY.stl: the solid outer shape of a product, in millimetres, with world +z up and the front facing -y, sitting on a flat base at z = 0. No cavity, no window, no holes, no seam and no internal parts yet. Assert it is one solid with assert len(body.solids()) == 1 before exporting. Export with tolerance=0.01.

How to get a form that looks designed rather than like a box with rounded corners:
- Think in surfaces first. Before writing code, decide in comments the silhouette from the front, the silhouette from the side, and how light should travel over the form.
- Build the body by lofting several rounded cross-sections, or by sweeps and splines, so its surfaces curve and blend. Do not make it from boxes joined together.
- Where two volumes meet, such as a raised panel on a body, make them one form with a broad, continuous blend. A hard step or a visible crease is a failure.
- Use generous radii. Keep every radius large relative to the part, and vary them on purpose. Fall back to a simpler blend only if an operation fails, and catch nothing silently.
- The base must be flat so it stands on a desk, with its lower edge softened."""


def screen_limits(base):
    """The largest front the screen-size check can ever pass, so a frozen body can never make it impossible."""
    size = build_card(base["parts"].split(",")[0])["features"]["screen"]["size"]
    short, long = sorted(size[:2])
    wide = long if base["width_to_height"][0] >= 1 else short
    tall = short if base["width_to_height"][0] >= 1 else long
    return {"screen_width": wide, "screen_height": tall, "max_width": wide / MIN_SCREEN_SHARE_OTHER, "max_height": tall / MIN_SCREEN_SHARE_OTHER, "tight_width": wide / MIN_SCREEN_SHARE_WIDEST, "tight_height": tall / MIN_SCREEN_SHARE_WIDEST}


def body_brief(base):
    lines = [f"The product: {base['look']}.", "The attached picture shows the look to aim for. Match its silhouette, proportions, softness and how the parts of the form blend. Ignore colours, and the screen and knob themselves, which are added later.", "The layout it must leave room for:", *[f"- {line}" for line in base["sheet"]], f"Width / height of the front: {base['width_to_height'][0]} to {base['width_to_height'][1]}. Depth at most {base['max_depth']} mm."]
    if base.get("min_body"):
        minimum = base["min_body"]
        lines.append(f"The parts need at least this much room: width {minimum['width']} mm, height {minimum['height']} mm, depth {minimum['depth']} mm. Keep the body at or above these. Sizes are real, so do not shrink below them for looks.")
    limit = screen_limits(base)
    lines.append(f"The real screen is {limit['screen_width']:.1f} mm wide and {limit['screen_height']:.1f} mm tall and cannot change. It must be the main feature of the front, so the front is at most {limit['max_width']:.1f} mm wide and {limit['max_height']:.1f} mm tall, and also either at most {limit['tight_width']:.1f} mm wide or at most {limit['tight_height']:.1f} mm tall. Size the form from these numbers, not from how large it looks in the picture.")
    return "\n".join(lines)


def render(mesh, out):
    plotter = pv.Plotter(off_screen=True, shape=(1, len(VIEWS)), window_size=(1800, 600))
    center = mesh.bounds.mean(axis=0)
    span = (mesh.bounds[1] - mesh.bounds[0]).max()
    surface = pv.wrap(mesh)
    for i, (label, direction) in enumerate(VIEWS.items()):
        plotter.subplot(0, i)
        plotter.add_text(label, font_size=11)
        plotter.add_mesh(surface, color="#d9d2c5", smooth_shading=True, split_sharp_edges=True, feature_angle=30)
        d = np.array(direction, dtype=float)
        d /= np.linalg.norm(d)
        plotter.camera_position = [tuple(center + d * span * 3.2), tuple(center), (0, 0, 1)]
    plotter.screenshot(str(out))


def body_problems(mesh, base):
    problems = []
    if not (mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0):
        problems.append(unsealed_result("BODY", mesh)["fix"])
        return problems
    if len(mesh.split(only_watertight=False)) != 1:
        problems.append("The body is in separate pieces. Make it one solid.")
    size = mesh.bounds[1] - mesh.bounds[0]
    ratio = size[0] / size[2]
    low, high = base["width_to_height"]
    if not low <= ratio <= high:
        problems.append(f"Width / height is {ratio:.2f}, wanted {low} to {high}. The size is {np.round(size, 1).tolist()} mm.")
    if size[1] > base["max_depth"]:
        problems.append(f"Depth is {size[1]:.1f} mm, limit {base['max_depth']} mm.")
    minimum = base.get("min_body")
    if minimum:
        for label, value, need in (("width", size[0], minimum["width"]), ("depth", size[1], minimum["depth"]), ("height", size[2], minimum["height"])):
            if value < need:
                problems.append(f"The {label} is {value:.1f} mm and the parts need at least {need} mm.")
    limit = screen_limits(base)
    if size[0] > limit["max_width"] or size[2] > limit["max_height"] or not (size[0] <= limit["tight_width"] or size[2] <= limit["tight_height"]):
        problems.append(f"The front is {size[0]:.1f} mm wide and {size[2]:.1f} mm tall, too big for the real screen. It must be at most {limit['max_width']:.1f} wide and {limit['max_height']:.1f} tall, and also either at most {limit['tight_width']:.1f} wide or at most {limit['tight_height']:.1f} tall.")
    if abs(mesh.bounds[0][2]) > 0.1:
        problems.append(f"The base should sit at z = 0, and it is at {mesh.bounds[0][2]:.2f}.")
    return problems


def design_body(base, picture, folder):
    """Returns (code, stl path, summary), keeping the best-scoring valid try. It never loops past the try limit, and a person sees every try."""
    folder = Path(folder)
    brief = body_brief(base)
    text = brief
    best, tokens, started, tries = None, 0, time.time(), []
    for number in range(1, MAX_BODY_TRIES + 1):
        attempt = folder / f"try-{number}"
        attempt.mkdir(parents=True, exist_ok=True)
        (attempt / "prompt.txt").write_text(text, encoding="utf-8")
        reply, usage = agent.ask_model(BODY_SYSTEM, text, picture)
        tokens += usage.get("total_tokens", 0)
        code = agent.extract_code(reply)
        ran, message = run_design(code, attempt)
        note = {"try": number, "ran": ran, "tokens": usage.get("total_tokens")}
        feedback = message
        stl = attempt / "BODY.stl"
        if ran and not stl.exists():
            ran, feedback = False, "The script did not write BODY.stl."
        if ran:
            mesh = load_stl(stl)
            problems = body_problems(mesh, base)
            note["problems"] = problems
            feedback = "\n".join(problems)
            if not problems:
                render(mesh, attempt / "preview.png")
                look = look_check(picture, attempt)
                note["score"] = look.get("score")
                note["differences"] = look.get("differences")
                score = look.get("score") or 0
                if best is None or score > best[0]:
                    best = (score, code, stl)
                if score >= GOOD_ENOUGH_SCORE:
                    tries.append(note)
                    print(f"body try {number}: score {score}, good enough", flush=True)
                    break
                feedback = f"A reviewer compared your render with the picture and scored it {score} out of 10. Make these changes, keeping the form valid:\n" + "\n".join(f"- {d}" for d in look.get("differences") or [])
        tries.append(note)
        print(f"body try {number}: {json.dumps({k: note.get(k) for k in ('ran', 'score', 'problems', 'tokens')})[:400]}", flush=True)
        text = "\n\n".join([brief, "Your last script:\n```python\n" + code + "\n```", feedback, "Reply with the complete new script."])
    summary = {"tries": tries, "tokens": tokens, "seconds": round(time.time() - started, 1), "best_score": best[0] if best else None}
    (folder / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    if best is None:
        return None, None, summary
    final = folder / "BODY.stl"
    shutil.copy(best[2], final)
    (folder / "body.py").write_text(best[1], encoding="utf-8")
    return best[1], final, summary


def frozen_body_brief(code):
    return "\n".join(["THE OUTER BODY IS DECIDED AND FROZEN. A designer already made it, and this is its code:", "```python", code, "```", "Reuse this code exactly to build the outer body inside your script. Shell plus Base together must keep this outside surface. You may only cut into it: the window, knob hole and recess, USB opening, screw holes and the seam. Do not add volume outside it or change its form. Make the cavity by offsetting inward, or by subtracting a simpler inner shape that keeps the walls within limits. If the parts truly cannot fit inside, keep the body and let the checks say so; do not quietly reshape it."])
