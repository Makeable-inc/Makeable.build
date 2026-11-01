"""Fixed checks on a design folder. Reads files only and never runs a design's code; the design cannot change these rules.

A design folder holds design.json and its STL files:
  {"print": {"PRINT_Carrier": "PRINT_Carrier.stl"},
   "purchased": {"PURCHASE_Board": {"part_id": "...", "transform": [[4 x 4 millimetres]]}},
   "holds": {"PRINT_Carrier": {"part": "PURCHASE_Board", "insert_from": "+z"}}}
"""
import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree

from card import DIRECTIONS, build_card, load_nodes
from parts import ensure_part

MIN_GAP = 0.1
NEAR = 1.0
GAP_TOLERANCE = 0.005
MAX_TRAVEL = 0.5
MIN_WALL_CARRIER = 1.2
MIN_WALL_CASE = 1.6
# Reported for a person to look at, but they do not fail a design: they are about looks or comfort, and the checks that matter for a working case cover the rest.
WARNING_ONLY = {"viewing_angle", "screen_faces_viewer"}
THIN_AREA_ALLOWED = 0.01
# Assumed, not in the AWS models: room for a chunky USB-C plug. Replace when a real cable is measured.
PLUG_ROOM = {"usb-c": {"width": 12.5, "height": 7.5, "length": 30.0}}
AXES = np.array([(1.0, 0, 0), (0, 1.0, 0), (0, 0, 1.0)])


def direction_vector(name):
    axis, side = DIRECTIONS[name]
    return AXES[axis] * (1 if side else -1)


def result(check, part, ok, measured=None, limit=None, where=None, fix=None):
    return {"check": check, "part": part, "ok": bool(ok), "measured": measured, "limit": limit, "where": where, "fix": None if ok else fix}


def rounded(point):
    return np.round(point, 2).tolist()


def thin_out(points, spacing):
    """Keeps one real point per small cell. The points are not snapped, because that would change the measured gaps."""
    _, keep = np.unique(np.round(points / spacing).astype(np.int64), axis=0, return_index=True)
    return points[keep]


@lru_cache(maxsize=8)
def part_surface(part_id):
    """The whole AWS model plus dense points on its surface, in the model's own coordinates."""
    mesh = trimesh.util.concatenate(list(load_nodes(ensure_part(part_id)).values()))
    samples, _ = trimesh.sample.sample_surface(mesh, 120000, seed=0)
    points = thin_out(np.vstack([mesh.vertices, samples]), 0.08)
    return mesh, points, thin_out(points, 0.25)


def apply(transform, points):
    return points @ transform[:3, :3].T + transform[:3, 3]


def is_rigid(transform):
    rotation = transform[:3, :3]
    return np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-6) and abs(np.linalg.det(rotation) - 1) < 1e-6 and np.allclose(transform[3], (0, 0, 0, 1))


def load_stl(path):
    """CAD exports can leave zero-area triangles at rounded corners, which falsely look like holes. Removes only those and exact duplicates; never fills a hole or moves a surface."""
    mesh = trimesh.load_mesh(path)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices(digits_vertex=5)
    return mesh


def unsealed_result(name, mesh):
    """Says exactly which edges are wrong, because "not sealed" alone gives the designer nothing to fix."""
    edges, counts = np.unique(np.sort(mesh.edges, axis=1), axis=0, return_counts=True)
    pinched, open_edges = edges[counts > 2], edges[counts == 1]
    listed = [[rounded(mesh.vertices[a]), rounded(mesh.vertices[b])] for a, b in pinched[:6]]
    if len(pinched):
        fix = f"Two surfaces touch along a line with no thickness between them, at these {len(pinched)} edges. Usually two cuts or blocks meet exactly at a corner. Move one by at least 0.3 mm so they clearly overlap or clearly separate."
    elif len(open_edges):
        listed = [[rounded(mesh.vertices[a]), rounded(mesh.vertices[b])] for a, b in open_edges[:6]]
        fix = f"The mesh has a hole with {len(open_edges)} open edges. Export a valid closed solid."
    else:
        fix = "The mesh has flipped faces or no volume. Export a valid closed solid."
    return result("sealed", name, False, measured=f"{len(pinched)} pinched edges, {len(open_edges)} open edges", limit="0 of each", where=f"edges: {listed}", fix=fix)


def check_mesh(name, mesh, min_wall):
    sealed = mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0
    if not sealed:
        return [unsealed_result(name, mesh)]
    results = [result("sealed", name, True)]
    pieces = mesh.split(only_watertight=False)
    listing = [f"{np.round(p.bounds[0], 1).tolist()} to {np.round(p.bounds[1], 1).tolist()}" for p in sorted(pieces, key=lambda p: -p.volume)]
    results.append(result("one_piece", name, len(pieces) == 1, measured=len(pieces), limit=1, where=f"pieces: {listing[:8]}", fix=f"The part is in {len(pieces)} separate pieces, largest first. Connect each to the first, or remove it, so it prints as one solid."))
    points, faces = trimesh.sample.sample_surface(mesh, 12000, seed=1)
    normals = mesh.face_normals[faces]
    hits, rays, _ = mesh.ray.intersects_location(points - normals * 1e-3, -normals, multiple_hits=False)
    thickness = np.full(len(points), np.inf)
    thickness[rays] = np.linalg.norm(hits - points[rays], axis=1)
    thin = thickness < min_wall
    worst = rounded(points[np.argmin(thickness)])
    region = f"{rounded(points[thin].min(axis=0))} to {rounded(points[thin].max(axis=0))}" if thin.any() else "none"
    results.append(result("wall", name, thin.mean() <= THIN_AREA_ALLOWED, measured=round(float(thin.mean()), 4), limit=f"under {THIN_AREA_ALLOWED} of the surface thinner than {min_wall} mm",
                          where=f"thinnest {thickness.min():.2f} mm near {worst}; thin areas span {region}", fix=f"Thicken the plastic near {worst} and the rest of that area to at least {min_wall} mm, or remove slivers there. If the thin area runs around an opening, a chamfer or rim is tapering to a knife edge: keep at least {min_wall} mm of straight wall at the opening, or remove the chamfer."))
    return results


def clearance(carrier, part_id, transform):
    """Smallest gap between part and carrier, measured both ways, and whether any of the part is inside the plastic."""
    mesh, points, coarse = part_surface(part_id)
    world = apply(transform, points)
    samples = np.vstack([trimesh.sample.sample_surface(carrier, 25000, seed=2)[0], carrier.vertices])
    # Exact measuring is slow, so it only runs on points a quick search finds close by. Anything further than this is not the smallest gap.
    rough, _ = cKDTree(samples).query(world, distance_upper_bound=NEAR)
    near = world[np.isfinite(rough)]
    gap, where = np.inf, None
    if len(near):
        _, distances, _ = trimesh.proximity.closest_point(carrier, near)
        i = int(np.argmin(distances))
        gap, where = float(distances[i]), near[i]
    # Inside tests cover both the close points and an even spread, so a part buried deep in thick plastic is still found.
    tested = np.vstack([near, apply(transform, coarse)])
    tested = tested[np.all((tested > carrier.bounds[0]) & (tested < carrier.bounds[1]), axis=1)]
    inside = carrier.contains(tested) if len(tested) else np.zeros(0, dtype=bool)
    if inside.any():
        _, depths, _ = trimesh.proximity.closest_point(carrier, tested[inside])
        i = int(np.argmax(depths))
        gap, where = -float(depths[i]), tested[inside][i]

    local = (samples - transform[:3, 3]) @ transform[:3, :3]
    rough, _ = cKDTree(points).query(local, distance_upper_bound=NEAR)
    local = local[np.isfinite(rough)]
    if len(local):
        _, back, _ = trimesh.proximity.closest_point(mesh, local)
        if back.min() < gap:
            i = int(np.argmin(back))
            gap, where = float(back[i]), apply(transform, local[i:i + 1])[0]
    return gap, int(inside.sum()), where


def travel(carrier, origins, direction):
    """How far the part can move in one direction before it hits the carrier."""
    near = origins[np.all((origins > carrier.bounds[0] - 60) & (origins < carrier.bounds[1] + 60), axis=1)]
    hits, rays, _ = carrier.ray.intersects_location(near, np.tile(direction, (len(near), 1)), multiple_hits=False)
    if not len(hits):
        return np.inf, None
    distances = np.linalg.norm(hits - near[rays], axis=1)
    i = int(np.argmin(distances))
    return float(distances[i]), near[rays[i]]


def port_room_box(usb, transform):
    """The space a plug needs, starting at the socket mouth and running outward, in world coordinates."""
    axis, side = DIRECTIONS[usb["opens_toward"]]
    room = PLUG_ROOM[usb["connector"]]
    low, high = np.array(usb["min"]), np.array(usb["max"])
    center = (low + high) / 2
    others = [i for i in range(3) if i != axis]
    wide, tall = sorted(others, key=lambda i: -(high[i] - low[i]))
    extents = np.zeros(3)
    extents[axis], extents[wide], extents[tall] = room["length"], room["width"], room["height"]
    center[axis] = usb["mouth"] + (room["length"] / 2 if side else -room["length"] / 2)
    box = trimesh.creation.box(extents=extents, transform=trimesh.transformations.translation_matrix(center))
    box.apply_transform(transform)
    return box


def check_holder(holder, carrier, part_name, part, card, transform, insert_from):
    results = []
    part_id = part["part_id"]
    gap, inside, where = clearance(carrier, part_id, transform)
    where_text = rounded(where) if where is not None else None
    results.append(result("clearance", holder, gap >= MIN_GAP - GAP_TOLERANCE and inside == 0, measured=round(gap, 3), limit=f"at least {MIN_GAP} mm", where=f"at {where_text}, {inside} points of {part_name} inside the plastic",
                          fix=f"{part_name} is too close to the plastic at {where_text}. Move that surface away until the gap is at least {MIN_GAP} mm."))

    _, _, coarse = part_surface(part_id)
    world = apply(transform, coarse)
    insert_direction = direction_vector(insert_from)
    distance, where = travel(carrier, world, insert_direction)
    results.append(result("insertable", holder, np.isinf(distance), measured=None if np.isinf(distance) else round(distance, 3), limit="no plastic in the way", where=None if where is None else rounded(where),
                          fix=f"Plastic blocks {part_name} going in from {insert_from} near {None if where is None else rounded(where)}. Remove the overhang."))

    for axis in range(3):
        for sign in (1, -1):
            direction = transform[:3, :3] @ (AXES[axis] * sign)
            if np.allclose(direction, insert_direction):
                continue
            distance, where = travel(carrier, world, direction)
            label = f"{'+' if direction.sum() > 0 else '-'}{'xyz'[int(np.argmax(np.abs(direction)))]}"
            results.append(result("held", holder, distance <= MAX_TRAVEL, measured=None if np.isinf(distance) else round(distance, 3), limit=f"at most {MAX_TRAVEL} mm toward {label}", where=None if where is None else rounded(where),
                                  fix=f"{part_name} can move {'freely' if np.isinf(distance) else f'{distance:.2f} mm'} toward {label}. Add or move a stop on that side."))

    if "usb" in card["features"]:
        usb = card["features"]["usb"]
        room = port_room_box(usb, transform)
        blocked = trimesh.boolean.intersection([carrier, room], engine="manifold").volume if carrier.is_volume else float("inf")
        results.append(result("usb_access", holder, blocked < 1e-3, measured=round(float(blocked), 3), limit="0 mm3 of plastic in the plug's path", where=f"plug path {rounded(room.bounds[0])} to {rounded(room.bounds[1])}",
                              fix=f"Open the plastic in the plug's path, {rounded(room.bounds[0])} to {rounded(room.bounds[1])}. The plug is assumed to be {PLUG_ROOM[usb['connector']]['width']} x {PLUG_ROOM[usb['connector']]['height']} mm."))
    return results


def check_design(folder, stage="carrier"):
    folder = Path(folder)
    report = {"folder": str(folder), "results": []}
    results = report["results"]

    def finish():
        report["failed"] = [r for r in results if not r["ok"] and r["check"] not in WARNING_ONLY]
        report["warnings"] = [r for r in results if not r["ok"] and r["check"] in WARNING_ONLY]
        report["passed"] = not report["failed"] and bool(results)
        # These failures skip later checks, so this report's count of failures cannot be compared with a full one.
        report["complete"] = not any(r["check"] in ("design_file", "files", "sealed", "part", "not_rescaled", "holds", "case") for r in report["failed"])
        return report

    try:
        design = json.loads((folder / "design.json").read_text(encoding="utf-8"))
        prints, purchased, holds = design["print"], design["purchased"], design["holds"]
    except (OSError, ValueError, KeyError, TypeError) as error:
        results.append(result("design_file", "design.json", False, measured=repr(error), fix="Write a design.json with print, purchased and holds."))
        return finish()

    meshes = {}
    for name, filename in prints.items():
        if not name.startswith("PRINT_") or Path(filename).name != filename or not (folder / filename).exists():
            results.append(result("files", name, False, measured=filename, fix="Each printed part must be named PRINT_ and be an STL file in the design folder."))
            continue
        try:
            meshes[name] = load_stl(folder / filename)
        except Exception as error:
            results.append(result("files", name, False, measured=repr(error), fix="The STL could not be read. Export it again."))
            continue
        results.extend(check_mesh(name, meshes[name], MIN_WALL_CARRIER if name == "PRINT_Carrier" else MIN_WALL_CASE))

    cards, transforms = {}, {}
    for name, part in purchased.items():
        try:
            transform = np.array(part["transform"], dtype=float)
            if transform.shape != (4, 4):
                raise ValueError("transform must be 4 x 4")
            cards[name] = build_card(part["part_id"])
        except (KeyError, TypeError, ValueError, OSError) as error:
            results.append(result("part", name, False, measured=repr(error), fix="Use a part_id that has a reviewed card, and a 4 x 4 transform."))
            continue
        rigid = is_rigid(transform)
        results.append(result("not_rescaled", name, rigid, limit="move and rotate only", fix="Parts keep their real size. Remove any scale or skew from the transform."))
        if rigid:
            transforms[name] = transform

    for holder, hold in holds.items():
        name = hold.get("part")
        if holder not in prints or name not in purchased or hold.get("insert_from") not in DIRECTIONS:
            results.append(result("holds", holder, False, measured=json.dumps(hold), fix="holds must name a printed part, a purchased part and an insert_from direction."))
            continue
        # A part that already failed has its own error; measuring fit against it would only add noise.
        if holder in meshes and name in transforms and meshes[holder].is_watertight:
            results.extend(check_holder(holder, meshes[holder], name, purchased[name], cards[name], transforms[name], hold["insert_from"]))
    if stage == "case":
        from case_checks import check_case
        base_file = folder / "base_design.json"
        design["base_design"] = json.loads(base_file.read_text(encoding="utf-8")) if base_file.exists() else None
        results.extend(check_case(design, meshes, purchased, cards, transforms))
    return finish()


if __name__ == "__main__":
    outcome = check_design(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "carrier")
    for r in outcome["results"]:
        print("PASS" if r["ok"] else "FAIL", r["check"], r["part"], r["measured"], r["limit"] or "", r["fix"] or "")
    print("PASSED" if outcome["passed"] else f"FAILED {len(outcome['failed'])}")
    sys.exit(0 if outcome["passed"] else 1)
