"""Character bodies: the body stage for designs with "style": "character" (ears, paws, antennas, spikes...).

Instead of sculpting one lofted skin, the AI joins simple, tested solids from body_parts.py. Rules check the result:
the usual body limits, a flat back plate for the rear cover, and every listed feature present (measured on the
geometry, not judged). A reviewer then goes feature by feature, and the AI sees its own render next to the concept.
The best valid script so far is always the one carried forward. Without "style": "character" nothing here runs.
"""
import inspect
import json
import re
import shutil
import time
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from scipy.spatial import ConvexHull

import agent
import body_parts
from checks import load_stl
from look_check import data_url
from sandbox import run_design

HERE = Path(__file__).resolve().parent
MAX_TRIES = 6
MAX_CRASHES = 4
GOOD_ENOUGH = 7
BACK_PLATE_SHARE = 0.6    # the flat back plate is at least this share of the outline seen from the back (ears count in the outline)
BACK_PLATE_FLAT = 0.93    # and the plate itself is this flat (the body rule's own limit, measured on the plate)
PITCH = 1.5               # mm voxels for finding features
CORE_SHARE = 0.07         # features are what stands out of the main form, rounded by this share of the width
MIN_FEATURE = 150.0       # mm3

API = "\n\n".join(f"def {name}{inspect.signature(fn)}:\n    \"\"\"{inspect.getdoc(fn)}\"\"\""
                  for name, fn in inspect.getmembers(body_parts, inspect.isfunction) if fn.__module__ == "body_parts")
EXAMPLE = (HERE / "body_examples" / "kitten.py").read_text(encoding="utf-8")

SYSTEM = f"""You are a product designer who models characterful desk gadgets in code. Write one complete Python script.
Reply with only the script, in one ```python block. Allowed imports: build123d, math, json, pathlib, body_parts.

The script builds the solid OUTER BODY of the product, in millimetres, world +z up, the front facing -y, standing on
z = 0, and ends with:
    export_stl(body, "BODY.stl", tolerance=0.01)
    export_step(body, "BODY.step")
No cavity, no window, no holes, no seam yet: those are added later inside this body.

How to build it (this is what works, every time):
- Make the main form with body_parts: rounded_loft (with a dome) for loafs, heads and most bodies, rounded_box for
  boxy robots and TVs, oval_loft only for truly round forms. The main form alone must hold the parts: a rule checks
  that the parts' box (the room they need, plus walls, from just behind the front) fits inside it.
- Add every listed feature with body_parts (ear, paw, antenna, cone_tip, spike_row, capsule, ellipsoid), placed on the
  main form's surface with surface_z / surface_x / surface_y_front, and joined with try_join.
- Creases where a feature meets the body are fine. Do not write your own lofts, sweeps, splines or fillets; do not
  write your own exact size asserts. If body_parts cannot make a shape, use the nearest simple solid.
- Finish with flat_sole(body), then broad_flat_back(body): the back (+y) becomes a flat printed cover and must be one
  broad flat plane. Keep features off the back plate, and make the main form deep enough that the cut leaves room.
- Name each feature in try_join exactly as the feature list names it, and print what was added and skipped, as
  the example does: a rule checks that every listed feature was added.

The body_parts module (already imported for you as a file next to the script):
{API}

A worked example that builds and passes:
```python
{EXAMPLE}
```"""

REVIEW = """The first image is the concept picture for a 3D-printed product. The second is the real body from four angles
(front, straight on, side, back); there is no screen or button yet, those come later. Ignore colours.
The required features are listed below. For each one, say whether it is clearly there and recognisable, and judge the
whole form against the concept. Reply with only JSON:
{"features": {"<feature name>": "present" | "weak" | "missing"}, "score": <0-10, 10 = reads clearly as the concept>,
 "changes": ["<up to 4 concrete changes in mm or proportions, most important first>"]}
Required features:
"""

FEATURE_PROMPT = """The picture is a concept for a 3D-printed desk gadget: {look}.
List its character features that stand out of the main body and can be printed: ears, paws, feet, arms, antennas,
horns, spikes, a tail, a snout. Not the screen, buttons, knob or anything drawn on. At most 8. Reply with only JSON:
[{{"name": "left ear", "kind": "ear", "where": "top left"}}, ...]
"where" uses these words only: top, bottom, left, right, middle, front, back, side."""


# ---------- the feature list ----------

def feature_list(base, picture, folder):
    """The design's own list if it has one, else read from the concept picture once and saved."""
    if base.get("features"):
        return base["features"]
    saved = folder / "features.json"
    if saved.exists():
        return json.loads(saved.read_text(encoding="utf-8"))
    reply, usage = agent.ask_model("Reply with only JSON.", FEATURE_PROMPT.format(look=base.get("look", "")), picture)
    agent.spend(usage)
    match = re.search(r"\[.*\]", reply, re.S)
    try:
        found = [f for f in json.loads(match.group(0)) if isinstance(f, dict) and f.get("name") and f.get("where")] if match else []
    except json.JSONDecodeError:
        found = []
    saved.write_text(json.dumps(found[:8], indent=1), encoding="utf-8")
    return found[:8]


# ---------- rules measured on the geometry ----------

def bumps(mesh):
    """What stands out of the main form, as (centre in 0..1 of the body's box, volume mm3)."""
    grid = mesh.voxelized(PITCH).fill()
    r = max(2, int(round(CORE_SHARE * mesh.extents[0] / PITCH)))
    ball = ndimage.generate_binary_structure(3, 1)
    core = ndimage.binary_opening(grid.matrix, structure=ball, iterations=r)
    extra = grid.matrix & ~ndimage.binary_dilation(core, structure=ball, iterations=1)
    labels, n = ndimage.label(extra)
    lo, hi = mesh.bounds
    out = []
    for i in range(1, n + 1):
        idx = np.argwhere(labels == i)
        volume = len(idx) * PITCH ** 3
        if volume >= MIN_FEATURE:
            centre = trimesh.transformations.transform_points(idx.astype(float), grid.transform).mean(axis=0)
            out.append(((centre - lo) / (hi - lo), volume))
    return out


def fits(where, t):
    tests = {"top": t[2] > 0.6, "bottom": t[2] < 0.38, "left": t[0] < 0.42, "right": t[0] > 0.58,
             "middle": 0.25 < t[0] < 0.75, "front": t[1] < 0.42, "back": t[1] > 0.58, "side": t[0] < 0.2 or t[0] > 0.8}
    return all(tests.get(word, True) for word in where.lower().replace(",", " ").split())


def missing_features(mesh, features):
    """Listed features with no bump where they should be, each bump used once."""
    free = bumps(mesh)
    missing = []
    for f in features:
        i = next((k for k, b in enumerate(free) if fits(f["where"], b[0])), None)
        if i is None:
            missing.append(f["name"])
        else:
            free.pop(i)
    return missing


def back_plate(mesh):
    """(share of the back outline that is flat plate, how flat the plate itself is)."""
    on = (mesh.face_normals[:, 1] > 0.999) & (np.abs(mesh.triangles_center[:, 1] - mesh.bounds[1][1]) < 0.1)
    if not on.any():
        return 0.0, 0.0

    def area(points):
        try:
            return float(ConvexHull(points).volume)
        except Exception:
            return 0.0
    plate = area(mesh.triangles[on][:, :, [0, 2]].reshape(-1, 2))
    outline = area(mesh.vertices[:, [0, 2]])
    return (plate / outline if outline else 0.0), (float(mesh.area_faces[on].sum()) / plate if plate else 0.0)


def added_names(output):
    """The features the body_parts joins confirmed, from the script's printed 'added:' line."""
    match = re.search(r"added:\s*(\[.*?\])", output)
    try:
        return set(json.loads(match.group(1).replace("'", '"'))) if match else set()
    except json.JSONDecodeError:
        return set()


ROOM_SLACK = 0.5  # mm: the parts' box (required_space already includes the walls) may touch the outside this much


def room_problem(mesh, base):
    """The main form must hold the box the parts need, plus walls, centred across, standing on the floor, from just
    behind the front. Checked on points spread over that box's surface."""
    need = base.get("min_body")
    if not need:
        return None
    lo, hi = mesh.bounds
    w, d, h = need["width"] - 2 * ROOM_SLACK, need["depth"] - ROOM_SLACK, need["height"] - ROOM_SLACK
    # The main body's front at its middle, not a paw or snout that stands out in front of it.
    hits, _, _ = mesh.ray.intersects_location([[(lo[0] + hi[0]) / 2, lo[1] - 50, h / 2]], [[0, 1, 0]], multiple_hits=False)
    front = float(hits[0][1]) if len(hits) else lo[1]
    box = trimesh.creation.box(extents=(w, d, h), transform=trimesh.transformations.translation_matrix(((lo[0] + hi[0]) / 2, front + ROOM_SLACK + d / 2, h / 2 + ROOM_SLACK)))
    points, _ = trimesh.sample.sample_surface(box, 3000, seed=2)
    outside = ~mesh.contains(points)
    if outside.mean() <= 0.01:
        return None
    bad = points[outside]
    return (f"The body does not hold the parts' box ({w:.0f} wide, {d:.0f} deep, {h:.0f} tall mm, walls included): "
            f"{outside.mean():.0%} of that box sticks out, around x {bad[:, 0].min():.0f} to {bad[:, 0].max():.0f}, "
            f"y {bad[:, 1].min():.0f} to {bad[:, 1].max():.0f}, z {bad[:, 2].min():.0f} to {bad[:, 2].max():.0f}. "
            "Make the main form roomier there (rounded_loft keeps the corners full); features do not count.")


def problems(mesh, base, features, output=""):
    from body_stage import body_problems
    found = [p for p in body_problems(mesh, base) if "of the back's outline is flat" not in p]
    room = room_problem(mesh, base)
    if room:
        found.append(room)
    share, flat = back_plate(mesh)
    if share < BACK_PLATE_SHARE or flat < BACK_PLATE_FLAT:
        found.append(f"The flat back plate covers {share:.0%} of the back outline and is {flat:.0%} flat; it needs "
                     f"{BACK_PLATE_SHARE:.0%} and {BACK_PLATE_FLAT:.0%}, so the rear cover prints flat and has room for screws. "
                     "Make the back end broad and call flat_back(body, y) with y a few mm inside the main form's back.")
    added = added_names(output)
    gone = [f["name"] for f in features if f["name"] not in added]
    if gone:
        found.append("These listed features are missing (nothing stands out of the main form there): " + ", ".join(gone)
                     + ". Add each with body_parts and try_join; check the printed 'skipped' list for why one failed.")
    return found


# ---------- seeing and reviewing ----------

def side_by_side(picture, render, out):
    concept = Image.open(picture).convert("RGB")
    body = Image.open(render).convert("RGB")
    concept = concept.resize((body.height, body.height))
    sheet = Image.new("RGB", (concept.width + body.width, body.height + 40), "white")
    sheet.paste(concept, (0, 40))
    sheet.paste(body, (concept.width, 40))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arial.ttf", 26)
    except OSError:
        font = None
    draw.text((10, 6), "concept", fill=(0, 0, 0), font=font)
    draw.text((concept.width + 10, 6), "your body so far", fill=(0, 0, 0), font=font)
    sheet.save(out)
    return out


def review(picture, attempt, features):
    import urllib.request
    names = "\n".join(f"- {f['name']} ({f['where']})" for f in features)
    content = [{"type": "input_text", "text": REVIEW + names}, {"type": "input_image", "image_url": data_url(picture)},
               {"type": "input_image", "image_url": data_url(attempt / "preview.png")}]
    body = json.dumps({"model": agent.MODEL, "input": [{"role": "user", "content": content}], "reasoning": {"effort": "medium"}}).encode()
    request = urllib.request.Request("https://api.openai.com/v1/responses", data=body,
                                     headers={"Authorization": f"Bearer {agent.api_key()}", "Content-Type": "application/json"})
    data = agent.send_with_retries(request)
    reply = "".join(c.get("text", "") for item in data["output"] if item["type"] == "message" for c in item["content"])
    match = re.search(r"\{.*\}", reply, re.S)
    try:
        found = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        found = {}
    result = {"score": found.get("score") if isinstance(found.get("score"), (int, float)) else None,
              "features": found.get("features") if isinstance(found.get("features"), dict) else {},
              "changes": found.get("changes") if isinstance(found.get("changes"), list) else [],
              "tokens": data.get("usage", {}).get("total_tokens")}
    (attempt / "review.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    return result


# ---------- the loop ----------

def design_character_body(base, picture, folder):
    """Returns (code, stl path, summary) like body_stage.design_body, keeping the best valid try."""
    from body_stage import body_brief, body_trace, render
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    features = feature_list(base, picture, folder)
    listed = "\n".join(f"- {f['name']}: {f.get('kind', '')}, {f['where']}" for f in features) or "- (none listed)"
    brief = "\n\n".join([body_brief(base), "Features the body must have, each one clearly there:\n" + listed])
    text, best, tries, tokens, started = brief, None, [], 0, time.time()
    number, valid, crashes = 0, 0, 0
    while valid < MAX_TRIES and crashes < MAX_CRASHES and not agent.job_out_of_tokens():
        number += 1
        attempt = agent.fresh_folder(folder / f"try-{number}")
        shutil.copy(HERE / "body_parts.py", attempt / "body_parts.py")
        (attempt / "prompt.txt").write_text(text, encoding="utf-8")
        image = side_by_side(picture, best["preview"], attempt / "seen.png") if best else picture
        began = time.time()
        reply, usage = agent.ask_model(SYSTEM, text, image)
        tokens += usage.get("total_tokens", 0)
        agent.spend(usage)
        code = agent.extract_code(reply)
        ran, message = run_design(code, attempt)
        stl = attempt / "BODY.stl"
        if ran and not (stl.exists() and stl.with_suffix(".step").exists()):
            ran, message = False, "The script did not write both BODY.stl and BODY.step."
        note = {"try": number, "ran": ran, "tokens": usage.get("total_tokens")}
        feedback = message[-2500:]
        if ran:
            mesh = load_stl(stl)
            output = (attempt / "output.txt").read_text(encoding="utf-8") if (attempt / "output.txt").exists() else message
            found = problems(mesh, base, features, output)
            note["shape_check_missing"] = missing_features(mesh, features)  # a cross-check only
            render(mesh, attempt / "preview.png")
            look = review(picture, attempt, features)
            agent.spend(look.get("tokens") or 0)
            tokens += look.get("tokens") or 0
            weak = [k for k, v in look["features"].items() if v != "present"]
            score = look["score"] or 0
            note.update(problems=found, score=score, weak_features=weak)
            if not found and (best is None or score > best["score"]):
                best = {"score": score, "code": code, "stl": stl, "preview": attempt / "preview.png"}
            lines = []
            if found:
                lines += ["It fails these rules, so it cannot be used:", *[f"- {p}" for p in found]]
            lines.append(f"A reviewer scored it {score}/10 against the concept." + (f" Features not clearly there: {', '.join(weak)}." if weak else ""))
            lines += [f"- {c}" for c in look["changes"]]
            feedback = "\n".join(lines)
            if not found and not weak and score >= GOOD_ENOUGH:
                tries.append(note)
                note["seconds"] = round(time.time() - began, 1)
                body_trace(folder, note, ran, feedback, usage)
                print(f"character body try {number}: score {score}, all features, good enough", flush=True)
                break
        tries.append(note)
        valid, crashes = (valid + 1, crashes) if ran else (valid, crashes + 1)
        agent.report_progress(stage="body", attempt_try=number, ran=ran, failed=[])
        note["seconds"] = round(time.time() - began, 1)
        body_trace(folder, note, ran, feedback, usage)
        print(f"character body try {number}: {json.dumps({k: note.get(k) for k in ('ran', 'score', 'weak_features', 'problems')})[:400]}", flush=True)
        # Always build on the best valid script; a crash or a worse try is reported, then dropped.
        start = best["code"] if best else code
        heading = "Your best script so far (it passes the rules; the image shows it next to the concept):" if best else "Your last script:"
        kept = "" if best is None or best["code"] == code else "Your last script was not better, so it was dropped. What went wrong with it:\n" + feedback + "\n\nNow improve the best script instead."
        text = "\n\n".join(p for p in [brief, heading + "\n```python\n" + start + "\n```", kept or feedback,
                                       "Reply with the complete new script. Keep what works; change one or two things."] if p)
    summary = {"tries": tries, "tokens": tokens, "seconds": round(time.time() - started, 1),
               "best_score": best["score"] if best else None, "features": features, "style": "character"}
    (folder / "summary.json").write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")
    if best is None:
        return None, None, summary
    final = folder / "BODY.stl"
    shutil.copy(best["stl"], final)
    shutil.copy(Path(best["stl"]).with_suffix(".step"), final.with_suffix(".step"))
    (folder / "body.py").write_text(best["code"], encoding="utf-8")
    shutil.copy(HERE / "body_parts.py", folder / "body_parts.py")
    return best["code"], final, summary
