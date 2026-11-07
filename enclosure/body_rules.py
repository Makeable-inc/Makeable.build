"""The fixed rules a character body must pass before the case is built inside it, in groups the body agent can
check one at a time. The AI proposes the shape; these rules decide. Each rule result is
{"rule", "group", "ok", "measured", "fix"}."""
import json
import re

import numpy as np
import trimesh
from scipy.spatial import ConvexHull

GROUPS = ("build", "size", "room", "back", "features")
ROOM_SLACK = 0.5        # mm: the parts' box (required_space already includes the walls) may touch the outside this much
BACK_PLATE_SHARE = 0.6  # the flat back plate is at least this share of the outline seen from the back (ears count)
BACK_PLATE_FLAT = 0.93  # and the plate itself is this flat
FACE_DEPTH = 3.0        # mm behind the main form's front: the face is measured on a slice there, like the case check
VISIBLE_SHARE = 0.002   # each feature stands outside the body by at least this share of the body's volume
VISIBLE_MIN = 300.0     # mm3, and at least this much
STEP_TOLERANCE = 0.5    # mm: BODY.step must have the same size as BODY.stl, or a feature was lost in the export


def rule(name, group, ok, fix, measured=None):
    return {"rule": name, "group": group, "ok": bool(ok), "measured": measured, "fix": None if ok else fix}


def printed(output, label):
    # The value right after "label:" (a list or an object), even when more is printed after it on the same line.
    match = re.search(rf"^{label}:\s*(\[.*?\]|\{{.*\}})", output, re.M)
    if not match:
        return None
    try:
        return json.loads(match.group(1).replace("'", '"'))
    except json.JSONDecodeError:
        return None


def face_slice(mesh):
    """The points of the body cut just behind the main form's front (read at its middle, so a paw or snout in front
    does not count), or None. Ears, antennas, arms, legs and tails away from that slice are ornaments."""
    lo, hi = mesh.bounds
    mid = [(lo[0] + hi[0]) / 2, lo[1] - 50, (lo[2] + hi[2]) / 2]
    hits, _, _ = mesh.ray.intersects_location([mid], [[0, 1, 0]], multiple_hits=False)
    front = float(hits[0][1]) if len(hits) else lo[1]
    cut = mesh.section(plane_origin=[0, front + FACE_DEPTH, 0], plane_normal=[0, 1, 0])
    if cut is None or len(cut.vertices) < 3:
        return None
    return np.asarray(cut.vertices)


def face_size(mesh):
    """Width and height of the face (see face_slice): the main form's front, ornaments not counted."""
    v = face_slice(mesh)
    if v is None:
        lo, hi = mesh.bounds
        return hi[0] - lo[0], hi[2] - lo[2]
    return float(v[:, 0].max() - v[:, 0].min()), float(v[:, 2].max() - v[:, 2].min())


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


def room_rule(mesh, base):
    """The main form holds the box the parts need, centred across, on the floor, from just behind the front (read at
    its rearmost point over the box's front, so a front that curves back at the top, bottom or sides still counts)."""
    need = base.get("min_body")
    if not need:
        return rule("room", "room", True, None)
    lo, hi = mesh.bounds
    w, d, h = need["width"] - 2 * ROOM_SLACK, need["depth"] - ROOM_SLACK, need["height"] - ROOM_SLACK
    face = face_slice(mesh)
    # centred on the main form's face, so a tail or arm on one side does not pull the box off centre
    x = float(face[:, 0].min() + face[:, 0].max()) / 2 if face is not None else (lo[0] + hi[0]) / 2
    # the front read at its rearmost point over the box's whole front (its height and its width), so a front that
    # curves back at the top, the bottom or the sides still counts
    rays = [[px, lo[1] - 50, z] for px in np.linspace(x - w / 2 + 1, x + w / 2 - 1, 7)
            for z in np.linspace(ROOM_SLACK + 1, ROOM_SLACK + h - 1, 9)]
    hits, _, _ = mesh.ray.intersects_location(rays, [[0, 1, 0]] * len(rays), multiple_hits=False)
    front = float(hits[:, 1].max()) if len(hits) == len(rays) else lo[1]
    box = trimesh.creation.box(extents=(w, d, h), transform=trimesh.transformations.translation_matrix((x, front + ROOM_SLACK + d / 2, h / 2 + ROOM_SLACK)))
    points, _ = trimesh.sample.sample_surface(box, 3000, seed=2)
    outside = ~mesh.contains(points)
    share = float(outside.mean())
    fix = None
    if share > 0.01:
        bad = points[outside]
        fix = (f"The body does not hold the parts' box ({w:.0f} wide, {d:.0f} deep, {h:.0f} tall mm, walls included): "
               f"{share:.0%} of it sticks out around x {bad[:, 0].min():.0f} to {bad[:, 0].max():.0f}, y {bad[:, 1].min():.0f} "
               f"to {bad[:, 1].max():.0f}, z {bad[:, 2].min():.0f} to {bad[:, 2].max():.0f}. Make the main form roomier there "
               "or round less there; features do not count.")
    return rule("room", "room", share <= 0.01, fix, round(share, 3))


def step_rule(step_path, mesh):
    """BODY.step (what the case stage loads) has the same size as BODY.stl (what was rendered and reviewed)."""
    try:
        from build123d import import_step
        from body_parts import bounds
        lo, hi = bounds(import_step(str(step_path)))
    except Exception as error:
        return rule("step_matches", "build", False, f"BODY.step could not be read back: {error}")
    worst = float(max(np.abs(np.array(lo) - mesh.bounds[0]).max(), np.abs(np.array(hi) - mesh.bounds[1]).max()))
    return rule("step_matches", "build", worst <= STEP_TOLERANCE,
                f"BODY.step differs from BODY.stl by {worst:.1f} mm, so part of the body (often a feature) was lost when it "
                "was saved. Join features with try_join (it keeps them export-safe) and keep each feature sunk into the body.",
                round(worst, 2))


def check(mesh, base, features, output, step_path=None, groups=GROUPS):
    """Every rule in the asked groups, for the body mesh and what its script printed."""
    from body_stage import screen_limits
    results = []
    size = mesh.bounds[1] - mesh.bounds[0]
    if "build" in groups:
        sealed = mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0
        results.append(rule("sealed", "build", sealed, "The body is not one closed solid. Rebuild it from body_parts and join with try_join."))
        pieces = len(mesh.split(only_watertight=False)) if sealed else 0
        results.append(rule("one_piece", "build", pieces == 1, f"The body is in {pieces} pieces. Make it one solid.", pieces))
        results.append(rule("on_floor", "build", abs(mesh.bounds[0][2]) <= 0.1, "Stand the body on z = 0 (flat_sole).", round(float(mesh.bounds[0][2]), 2)))
        if step_path is not None:
            results.append(step_rule(step_path, mesh))
    if "size" in groups:
        results.append(rule("depth", "size", size[1] <= base["max_depth"], f"Depth is {size[1]:.1f} mm, limit {base['max_depth']} mm.", round(float(size[1]), 1)))
        width, height = face_size(mesh)
        limit = screen_limits(base)
        fits = width <= limit["max_width"] and height <= limit["max_height"]
        results.append(rule("face_size", "size", fits,
                            f"The face (the main form's front, ornaments not counted) is {width:.1f} x {height:.1f} mm. It must be at most "
                            f"{limit['max_width']:.1f} wide and {limit['max_height']:.1f} tall.", [round(width, 1), round(height, 1)]))
        # The main form's size from the script's "core:" line; without it, the whole body counts (stricter, never skipped).
        core = printed(output, "core") or [float(v) for v in size]
        if base.get("width_to_height"):
            low, high = base["width_to_height"]
            ratio = core[0] / core[2]
            results.append(rule("proportion", "size", low <= ratio <= high,
                                f"The main form's width / height is {ratio:.2f}, wanted {low} to {high} (features do not count).", round(ratio, 2)))
    if "room" in groups:
        results.append(room_rule(mesh, base))
    if "back" in groups:
        share, flat = back_plate(mesh)
        results.append(rule("back_plate", "back", share >= BACK_PLATE_SHARE and flat >= BACK_PLATE_FLAT,
                            f"The flat back plate covers {share:.0%} of the back outline and is {flat:.0%} flat; it needs "
                            f"{BACK_PLATE_SHARE:.0%} and {BACK_PLATE_FLAT:.0%}, so the rear cover prints flat. Use soft_box (its back "
                            "stays flat) and broad_flat_back(body, share=0.65).", [round(share, 2), round(flat, 2)]))
    if "features" in groups:
        joined = [str(n) for n in printed(output, "added") or []]
        added = set(joined)
        sizes = printed(output, "features") or {}
        twice = sorted({n for n in joined if joined.count(n) > 1})
        # each listed feature is one piece with its own name: two pieces under one name would let a missing one pass
        results.append(rule("feature_names", "features", not twice,
                            f"These names were used for more than one piece: {', '.join(twice)}. Give every piece its own "
                            "name, exactly as the brief lists it (for example 'spike 1', 'spike 2', 'spike 3').", twice or None))
        need = max(VISIBLE_MIN, VISIBLE_SHARE * mesh.volume)
        for f in features:
            name = f["name"]
            if name not in added:
                results.append(rule(f"feature:{name}", "features", False, f"{name} is not on the body. Add it with try_join, named exactly '{name}'."))
                continue
            outside = (sizes.get(name) or {}).get("outside_mm3", 0)
            results.append(rule(f"feature:{name}", "features", outside >= need,
                                f"{name} stands only {outside:.0f} mm3 outside the body; it needs {need:.0f} mm3 to read from a metre "
                                "away. Make it bigger or bolder.", round(outside)))
    return results
