"""Fixed checks on a closed case: all parts together, the screen, the assembly order, the screws and standing on a desk."""
import json

import numpy as np
import trimesh
from scipy.spatial import ConvexHull, QhullError

from card import DIRECTIONS, load_nodes
from parts import ensure_part
from checks import load_stl, AXES, GAP_TOLERANCE, MAX_TRAVEL, MIN_GAP, apply, clearance, direction_vector, part_surface, port_room_box, result, rounded, sanding_depth, travel, travel_ends

VIEW_ANGLE = 50
MAX_WINDOW_GAP = 1.0
MAX_VISIBLE_INSIDE = 1.0
MIN_SCREEN_SHARE_WIDEST = 0.5
MIN_SCREEN_SHARE_OTHER = 0.4
MAX_SCREEN_TILT_UP = 70
MIN_BALANCE_MARGIN = 2.0
MIN_SCREWS = 1
# Screws and snap latches together. A snap holds its side, so one screw and one snap are enough.
MIN_FASTENERS = 2
# Centre to centre. A second screw beside the first holds nothing more and weakens the post they share.
MIN_SCREW_GAP = 10.0
REQUIRED_PARTS = ["PRINT_Shell", "PRINT_Base"]
MIN_COVER_FLAT = 0.9
MIN_PART_CONTACT = 0.25
BED_TOLERANCE = 0.1
# Assumed M2 x 8 self-tapping screw, until a real one is chosen and measured.
SCREW = {"length": 8.0, "grip": 3.0, "shank_radius": 1.1, "pilot_radius": 0.75, "post_radius": 2.3, "head_radius": 2.0, "driver_radius": 2.6, "driver_length": 40.0}


def merged(meshes):
    return trimesh.util.concatenate(list(meshes))


def plastic_points(mesh):
    return np.vstack([trimesh.sample.sample_surface(mesh, 8000, seed=3)[0], mesh.vertices])


def overlap(a, b):
    return float(trimesh.boolean.intersection([a, b], engine="manifold").volume)


def cylinder(radius, start, direction, length):
    mesh = trimesh.creation.cylinder(radius=radius, height=length, sections=32)
    mesh.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], direction))
    mesh.apply_translation(np.array(start) + np.array(direction) * length / 2)
    return mesh


def ring(outer, inner, start, direction, length):
    return trimesh.boolean.difference([cylinder(outer, start, direction, length), cylinder(inner, np.array(start) - np.array(direction) * 0.5, direction, length + 1)], engine="manifold")


def check_plastic_pairs(meshes):
    results = []
    names = list(meshes)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            volume = overlap(meshes[a], meshes[b])
            points_a, points_b = plastic_points(meshes[a]), plastic_points(meshes[b])
            _, one, _ = trimesh.proximity.closest_point(meshes[b], points_a)
            _, two, _ = trimesh.proximity.closest_point(meshes[a], points_b)
            gap = float(min(one.min(), two.min()))
            place = rounded(points_a[np.argmin(one)] if one.min() <= two.min() else points_b[np.argmin(two)])
            results.append(result("parts_gap", f"{a} / {b}", volume < 1e-3 and gap >= MIN_GAP - GAP_TOLERANCE, measured=round(gap, 3), limit=f"at least {MIN_GAP} mm and no overlap", where=f"closest at {place}, overlap {volume:.3f} mm3",
                                  fix=f"{a} and {b} overlap or touch near {place}. Keep every mating surface at least {MIN_GAP} mm apart."))
    return results


def check_retained(name, origins, others):
    results = []
    for axis in range(3):
        for sign in (1, -1):
            distance, where = travel(others, origins, AXES[axis] * sign)
            label = f"{'+' if sign > 0 else '-'}{'xyz'[axis]}"
            moves = "freely" if np.isinf(distance) else f"{distance:.2f} mm"
            results.append(result("retained", name, distance <= MAX_TRAVEL, measured=None if np.isinf(distance) else round(distance, 3), limit=f"at most {MAX_TRAVEL} mm toward {label} in the closed case", where=None if where is None else rounded(where),
                                  fix=f"In the closed case {name} can move {moves} toward {label}. Add a stop or close the gap on that side."))
    return results


def glueable(glued, cards):
    """Glue is for a board that just sits in place. A part you press or turn needs a real support."""
    return {name for name in glued if not {"shaft", "touch"} & set(cards.get(name, {}).get("features", {}))}


def allow_glue(results, glued):
    """A purchased part marked as glued may be loose in the closed case, if it has a surface to glue to: plastic within the limit on at least one side."""
    results = [dict(r) for r in results]
    for name in glued:
        own = [r for r in results if r["part"] == name and r["check"] == "retained"]
        if not any(r["ok"] for r in own):
            continue
        for r in own:
            if not r["ok"]:
                r["can_be_glued"] = True
                r["fix"] = f"Glue {name} in place during assembly, because no plastic stops it {r['limit']}. Add a stop to avoid glue."
    return results


def check_assembly(steps, meshes, purchased, part_points):
    """Each part must reach its final place in a straight line, past everything already placed."""
    expected = set(meshes) | set(purchased)
    listed = [s.get("add") for s in steps]
    if sorted(map(str, listed)) != sorted(expected) or any(s.get("from") not in DIRECTIONS for s in steps[1:]):
        return [result("assembly", "case", False, measured=listed, limit=sorted(expected), fix="List every printed and purchased part exactly once in case.assembly, each after the first with a from direction such as +z.")]
    results = []
    placed = [steps[0]["add"]]
    for step in steps[1:]:
        moving, direction = step["add"], direction_vector(step["from"])
        worst, where, blocker, moving_at, blocker_at = np.inf, None, None, None, None
        depth = 0.0
        for other in placed:
            pairs = []
            if moving in meshes:
                source = plastic_points(meshes[other]) if other in meshes else part_points[other]
                pairs.append((meshes[moving], source, -direction, True))
            if other in meshes:
                source = plastic_points(meshes[moving]) if moving in meshes else part_points[moving]
                pairs.append((meshes[other], source, direction, False))
            for target, source, ray, landed_on_moving in pairs:
                distance, point, landed = travel_ends(target, source, ray)
                depth = max(depth, sanding_depth(target, source, ray))
                if distance < worst:
                    worst, where, blocker = distance, point, other
                    moving_at, blocker_at = (landed, point) if landed_on_moving else (point, landed)
        place = None if where is None else rounded(where)
        moving_place, blocker_place = (None, None) if where is None else (rounded(moving_at), rounded(blocker_at))
        results.append(result("assembly", moving, np.isinf(worst), measured=None if np.isinf(worst) else round(worst, 3), limit=f"clear path from {step['from']}", where=place,
                              fix=f"{moving} cannot come in from {step['from']}: {moving} at {moving_place} hits {blocker} at {blocker_place} after {worst:.2f} mm of travel, and about {depth:.1f} mm of material is in the way. These two can clear each other in the final position and still collide on the way in. Move, shorten or trim the feature at one of those two points, so it sits outside the other's outline as seen along {step['from']}."))
        results[-1]["sanding_depth"] = depth
        results[-1]["moving_at"], results[-1]["blocker_at"] = moving_place, blocker_place
        placed.append(moving)
    return results


MAX_SNAP_STRAIN = 0.02
MIN_HOOK_DEPTH = 0.4
MAX_HOOK_DEPTH = 1.5
MAX_HOOK_PLAY = 0.5


def box_mesh(low, high):
    low, high = np.array(low, dtype=float), np.array(high, dtype=float)
    return trimesh.creation.box(extents=high - low, transform=trimesh.transformations.translation_matrix((low + high) / 2))


def check_snaps(snaps, meshes):
    """A snap latch holds only if its arm can bend, the hook catches plastic behind it, and printed plastic takes the bend."""
    results = []
    for index, snap in enumerate(snaps, 1):
        label = f"snap {index}"
        strain = 1.5 * snap["arm_thickness"] * snap["hook_depth"] / snap["arm_length"] ** 2
        results.append(result("snap_strain", label, strain <= MAX_SNAP_STRAIN and MIN_HOOK_DEPTH <= snap["hook_depth"] <= MAX_HOOK_DEPTH, measured=f"{strain:.2%} bend, hook {snap['hook_depth']} mm", limit=f"at most {MAX_SNAP_STRAIN:.0%} bend, hook {MIN_HOOK_DEPTH} to {MAX_HOOK_DEPTH} mm", where=snap["at"],
                              fix="Make the arm longer or thinner, or the hook shallower, so printed plastic can take the bend."))
        into = meshes.get(snap["into"])
        if into is None:
            continue
        low, high = np.array(snap["hook"][0], dtype=float), np.array(snap["hook"][1], dtype=float)
        grid = np.array([[x, high[1], z] for x in np.linspace(low[0] + 0.1, high[0] - 0.1, 3) for z in np.linspace(low[2] + 0.5, high[2] - 0.5, 4)])
        distance, _ = travel(into, grid, np.array([0, 1.0, 0]))
        results.append(result("snap_catch", label, distance <= MAX_HOOK_PLAY, measured=None if np.isinf(distance) else round(distance, 2), limit=f"plastic within {MAX_HOOK_PLAY} mm behind the hook", where=snap["at"],
                              fix="The hook has nothing to catch. Cut its pocket into solid Shell wall, so plastic sits just behind the hook."))
        flex = box_mesh(*snap["flex"])
        blocked = sum(overlap(m, flex) for name, m in meshes.items() if name != snap["on"])
        results.append(result("snap_flex", label, blocked < 1e-3, measured=round(blocked, 3), limit="0 mm3 of other plastic where the arm bends", where=snap["at"],
                              fix="The arm has no room to bend as it goes in. Keep the slot beside the arm clear."))
    return results


def trimmed_for_assembly(meshes, snaps):
    """The hooks are meant to ride over the Shell and click in, so the straight-path check leaves them out. check_snaps tests them instead."""
    if not snaps:
        return meshes
    trimmed = dict(meshes)
    for name in {s["on"] for s in snaps}:
        if name in trimmed:
            hooks = [box_mesh(np.array(s["hook"][0]) - 0.05, np.array(s["hook"][1]) + 0.05) for s in snaps if s["on"] == name]
            trimmed[name] = trimesh.boolean.difference([trimmed[name], *hooks], engine="manifold")
    return trimmed


def check_screw_spread(screws, meshes, snaps=()):
    """The cover must be fastened across the whole seam: a screw in each half of its width and of its height, so no side is left to lift."""
    if not screws or any(not {"head_at", "drive_from", "through"} <= set(s) or s["through"] not in meshes for s in screws):
        return []
    cover = meshes[screws[0]["through"]]
    axis = DIRECTIONS[screws[0]["drive_from"]][0]
    across = [i for i in range(3) if i != axis]
    # A snap latch holds its side of the cover too.
    heads = np.array([s["head_at"] for s in screws] + [s["at"] for s in snaps], dtype=float)
    results = []
    for i in across:
        low, high = cover.bounds[0][i], cover.bounds[1][i]
        middle = (low + high) / 2
        lower, upper = int((heads[:, i] < middle).sum()), int((heads[:, i] > middle).sum())
        name = "xyz"[i]
        results.append(result("screw_spread", f"along {name}", lower > 0 and upper > 0, measured=f"{lower} below and {upper} above the middle", limit="at least one screw in each half of the cover", where=f"cover {low:.1f} to {high:.1f} on {name}, middle {middle:.1f}",
                              fix=f"All the screws and snaps are on one side along {name}, so the other side of the cover can lift. Where a side has no room for a screw post, a snap latch can hold it. Put at least one screw on each side of {name} = {middle:.1f}, near the corners."))
    return results


def check_screw_count(screws, snaps=()):
    total = len(screws) + len(snaps)
    ok = len(screws) >= MIN_SCREWS and total >= MIN_FASTENERS
    return [result("screw_count", "case", ok, measured=f"{len(screws)} screws, {len(snaps)} snaps", limit=f"at least {MIN_FASTENERS} fasteners, at least {MIN_SCREWS} of them a screw",
                   fix=f"Hold the case shut with at least {MIN_FASTENERS} fasteners, spread across the cover: screws, or a screw and a snap latch on the side with no room for a post.")]


def check_screw_gap(screws):
    """Every pair of screws at least MIN_SCREW_GAP apart. Two screws side by side are one fastening spot, not two."""
    heads = []
    for screw in screws:
        try:
            heads.append(np.array(screw["head_at"], dtype=float))
        except (KeyError, TypeError, ValueError):
            return []
    results = []
    for i in range(len(heads)):
        for j in range(i + 1, len(heads)):
            gap = float(np.linalg.norm(heads[i] - heads[j]))
            results.append(result("screw_gap", f"screws {i + 1} and {j + 1}", gap >= MIN_SCREW_GAP, measured=round(gap, 1), limit=f"at least {MIN_SCREW_GAP:.0f} mm apart, centre to centre",
                                  where=f"{heads[i].round(1).tolist()} and {heads[j].round(1).tolist()}",
                                  fix=f"Screws {i + 1} and {j + 1} are only {gap:.1f} mm apart, so they hold the same spot. Move one to another corner, or drop it and hold that side with a snap latch."))
    return results


def check_screws(screws, meshes, part_points, snaps=()):
    results = check_screw_count(screws, snaps) + check_screw_gap(screws)
    results.extend(check_screw_spread(screws, meshes, snaps))
    for i, screw in enumerate(screws):
        label = f"screw {i + 1}"
        try:
            head = np.array(screw["head_at"], dtype=float)
            outward = direction_vector(screw["drive_from"])
            through, into = meshes[screw["through"]], meshes[screw["into"]]
        except (KeyError, TypeError, ValueError):
            results.append(result("screw_fit", label, False, measured=json.dumps(screw, default=str), fix="Each screw needs head_at, drive_from such as -z, through and into, naming printed parts."))
            continue
        inward = -outward
        place = rounded(head)
        blocked = sum(overlap(m, cylinder(SCREW["driver_radius"], head + outward * 0.01, outward, SCREW["driver_length"])) for m in meshes.values())
        results.append(result("screw_driver", label, blocked < 1e-3, measured=round(blocked, 2), limit="0 mm3 of plastic in the screwdriver's path", where=place,
                              fix=f"Open a path for a {SCREW['driver_radius'] * 2} mm screwdriver straight out from {place} toward {screw['drive_from']}."))
        free_length = SCREW["length"] - SCREW["grip"]
        tip_start = head + inward * free_length
        shank = sum(overlap(m, cylinder(SCREW["shank_radius"], head, inward, free_length - 0.01)) for m in meshes.values())
        results.append(result("screw_fit", label, shank < 0.05, measured=round(shank, 2), limit=f"clear hole for the first {free_length} mm", where=place,
                              fix=f"Make a clear {SCREW['shank_radius'] * 2} mm hole from {place} for {free_length} mm along the screw, through every part."))
        seat = ring(SCREW["head_radius"], SCREW["shank_radius"], head, inward, 1.0)
        share = overlap(through, seat) / seat.volume
        results.append(result("screw_seat", label, share >= 0.7, measured=round(share, 2), limit="at least 0.7 of the head's seat is plastic", where=place,
                              fix=f"Put at least 1 mm of {screw['through']} directly under the screw head, and set head_at exactly on that surface, now {place}."))
        post = ring(SCREW["post_radius"], SCREW["pilot_radius"], tip_start, inward, SCREW["grip"])
        grip = overlap(into, post) / post.volume
        pilot = overlap(into, cylinder(SCREW["pilot_radius"], tip_start, inward, SCREW["grip"]))
        tip = rounded(tip_start)
        results.append(result("screw_grip", label, grip >= 0.9 and pilot < 0.05, measured=f"{grip:.2f} solid around, {pilot:.2f} mm3 in the pilot hole", limit=f"last {SCREW['grip']} mm: {SCREW['pilot_radius'] * 2} mm pilot hole inside a {SCREW['post_radius'] * 2} mm post of {screw['into']}", where=tip,
                              fix=f"From {tip} for {SCREW['grip']} mm along the screw, {screw['into']} needs a {SCREW['post_radius'] * 2} mm solid post with a {SCREW['pilot_radius'] * 2} mm pilot hole."))
        for name, points in part_points.items():
            along = (points - head) @ inward
            radial = np.linalg.norm((points - head) - np.outer(along, inward), axis=1)
            hit = (along > -2) & (along < SCREW["length"]) & (radial < SCREW["head_radius"] + MIN_GAP)
            results.append(result("screw_clear", f"{label} / {name}", not hit.any(), measured=int(hit.sum()), limit="no part in the screw's path", where=place, fix=f"Move the screw at {place} away from {name}."))
    return results


def check_window_view(name, card, transform, union, others, axis, side):
    """Looking straight at the window, you should see only the board's glass and frame, not the inside of the case."""
    nodes = load_nodes(ensure_part(card["part_id"]))
    face = merged(nodes[n] for feature in ("glass", "frame") for n in card["features"][feature]["nodes"]).copy()
    face.apply_transform(transform)
    frame = card["features"]["frame"]
    spacing = 0.2
    us = np.arange(frame["min"][others[0]] - 1, frame["max"][others[0]] + 1, spacing)
    vs = np.arange(frame["min"][others[1]] - 1, frame["max"][others[1]] + 1, spacing)
    grid = np.zeros((len(us) * len(vs), 3))
    grid[:, others[0]], grid[:, others[1]] = [c.ravel() for c in np.meshgrid(us, vs, indexing="ij")]
    # Start outside the whole case, because a raised panel can stand further forward than the screen.
    face_level = card["features"]["glass"]["max" if side else "min"][axis]
    grid[:, axis] = face_level + (1 if side else -1)
    inward = transform[:3, :3] @ (AXES[axis] * (-1 if side else 1))
    start_distance = float(np.max((union.vertices - apply(transform, grid[:1])[0]) @ -inward)) + 5
    origins = apply(transform, grid) - inward * start_distance
    face_distance = start_distance + 1
    rays = np.tile(inward, (len(origins), 1))
    locations, indexes, _ = union.ray.intersects_location(origins, rays, multiple_hits=False)
    plastic = np.full(len(origins), np.inf)
    plastic[indexes] = np.linalg.norm(locations - origins[indexes], axis=1)
    locations, indexes, _ = face.ray.intersects_location(origins, rays, multiple_hits=False)
    board = np.full(len(origins), np.inf)
    board[indexes] = np.linalg.norm(locations - origins[indexes], axis=1)
    # A ray that reaches the board first sees the board, and one stopped by plastic ahead of the board's face is the bezel. Plastic further in is a view into the case.
    seen_inside = ~(board <= plastic) & (plastic > face_distance)
    area = float(seen_inside.sum()) * spacing ** 2
    where = rounded(origins[seen_inside].mean(axis=0)) if seen_inside.any() else None
    return result("window_view", name, area <= MAX_VISIBLE_INSIDE, measured=round(area, 2), limit=f"at most {MAX_VISIBLE_INSIDE} mm2 of the case's inside visible through the window", where=where,
                  fix="Looking straight at the window you can see into the case beside the glass, often at the corners. Match the window's corners to the glass's rounded corners, or bring the rim closer.")


def check_screen(name, card, transform, union):
    results = []
    screen, glass = card["features"]["screen"], card["features"]["glass"]
    rotation, offset = transform[:3, :3], transform[:3, 3]
    axis, side = DIRECTIONS[card["front"]]
    front = AXES[axis] * (1 if side else -1)
    normal = rotation @ front
    others = [i for i in range(3) if i != axis]
    low, high = np.array(screen["min"]), np.array(screen["max"])

    grid = []
    for u in np.linspace(low[others[0]], high[others[0]], 9):
        for v in np.linspace(low[others[1]], high[others[1]], 9):
            point = np.zeros(3)
            point[others[0]], point[others[1]], point[axis] = u, v, screen["max" if side else "min"][axis] + (0.01 if side else -0.01)
            grid.append(point)
    grid = apply(transform, np.array(grid))
    tilt = np.tan(np.radians(VIEW_ANGLE))
    worst = 0.0
    for sign_a, sign_b in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]:
        ray = rotation @ (front + AXES[others[0]] * sign_a * tilt + AXES[others[1]] * sign_b * tilt)
        ray /= np.linalg.norm(ray)
        hits = union.ray.intersects_any(grid, np.tile(ray, (len(grid), 1)))
        worst = max(worst, float(hits.mean()))
    results.append(result("viewing_angle", name, worst == 0, measured=round(worst, 3), limit=f"nothing covers the screen from {VIEW_ANGLE} degrees off centre",
                          fix=f"Plastic around the window covers part of the screen when seen from {VIEW_ANGLE} degrees. Chamfer the window or make the bezel shallower."))

    plane = glass["max" if side else "min"][axis] - (0.1 if side else -0.1)
    glass_low, glass_high = np.array(glass["min"]), np.array(glass["max"])
    gaps = []
    for which, across in ((0, 1), (1, 0)):
        for bound, sign in ((glass_low, -1), (glass_high, 1)):
            for t in np.linspace(glass_low[others[across]], glass_high[others[across]], 11)[1:-1]:
                point = np.zeros(3)
                point[axis], point[others[which]], point[others[across]] = plane, bound[others[which]], t
                gaps.append(travel(union, apply(transform, point[None]), rotation @ (AXES[others[which]] * sign))[0])
    largest = float(np.max(gaps))
    results.append(result("window_fit", name, largest <= MAX_WINDOW_GAP, measured=None if np.isinf(largest) else round(largest, 3), limit=f"at most {MAX_WINDOW_GAP} mm from glass edge to window edge, measured 0.1 mm below the glass face",
                          fix=f"Fit the window around the glass so no gap exceeds {MAX_WINDOW_GAP} mm. The plastic must reach the level just below the glass face all round."))

    results.append(check_window_view(name, card, transform, union, others, axis, side))

    local = (union.vertices - offset) @ rotation
    case_size =local[:, others].max(axis=0) - local[:, others].min(axis=0)
    shares = (high - low)[others] / case_size
    best, other = float(shares.max()), float(shares.min())
    results.append(result("screen_share", name, best >= MIN_SCREEN_SHARE_WIDEST and other >= MIN_SCREEN_SHARE_OTHER, measured=[round(best, 2), round(other, 2)], limit=f"screen is at least {MIN_SCREEN_SHARE_WIDEST} of the case front one way and {MIN_SCREEN_SHARE_OTHER} the other",
                          where=f"case front {np.round(case_size, 1).tolist()} mm, screen {np.round((high - low)[others], 1).tolist()} mm", fix="The screen looks small in the case. Trim the case front so the screen is its main feature."))

    elevation = float(np.degrees(np.arcsin(np.clip(normal[2], -1, 1))))
    results.append(result("screen_faces_viewer", name, -5 <= elevation <= MAX_SCREEN_TILT_UP, measured=round(elevation, 1), limit=f"screen faces between -5 and {MAX_SCREEN_TILT_UP} degrees above horizontal when the case sits on a desk",
                          fix="Turn the board and case so the screen faces a person at a desk. World +z is up and the case sits at its lowest z."))
    return results


def check_standing(meshes):
    union = merged(meshes.values())
    bottom = union.bounds[0][2]
    contact = union.vertices[union.vertices[:, 2] < bottom + 0.3][:, :2]
    center = sum(m.center_mass * m.volume for m in meshes.values()) / sum(m.volume for m in meshes.values())
    try:
        hull = ConvexHull(contact)
        margin = float(-np.max(hull.equations[:, :2] @ center[:2] + hull.equations[:, 2]))
        footprint = round(float(hull.volume), 1)
    except (QhullError, ValueError):
        margin, footprint = -np.inf, 0.0
    return [result("stands", "case", margin >= MIN_BALANCE_MARGIN, measured=round(margin, 2) if np.isfinite(margin) else None, limit=f"centre of weight at least {MIN_BALANCE_MARGIN} mm inside the footprint", where=f"footprint {footprint} mm2 at z {bottom:.2f}",
                   fix="The case tips over or has no flat bottom. Give it a flat base at its lowest z, wide enough that its centre of weight sits well inside.")]


def side_flat_share(mesh, axis, sign):
    """How much of a part's outline touches the print bed when this side faces down, from 0 to 1."""
    normal = np.zeros(3)
    normal[axis] = sign
    extreme = mesh.bounds[1 if sign > 0 else 0][axis]
    on_bed = (mesh.face_normals @ normal > 0.999) & (np.abs(mesh.triangles_center[:, axis] - extreme) < BED_TOLERANCE)
    across = [i for i in range(3) if i != axis]
    try:
        outline = float(ConvexHull(mesh.vertices[:, across]).volume)
    except (QhullError, ValueError):
        return 0.0
    return float(mesh.area_faces[on_bed].sum()) / outline if outline > 0 else 0.0


def back_flat_share(mesh, front):
    """The same measure for the side opposite the front, which becomes the outside of the rear cover."""
    axis, side = DIRECTIONS[front]
    return side_flat_share(mesh, axis, -1 if side else 1)


def check_flat_on_bed(meshes):
    """A printer builds up from a flat bed, so every printed part needs a side that sits flat. The rear cover is a plate, so nearly all of its outline must touch."""
    results = []
    for name, mesh in meshes.items():
        size = mesh.bounds[1] - mesh.bounds[0]
        widest = max(float(np.prod(np.delete(size, axis))) for axis in range(3))
        # A narrow edge would topple on the bed, so only broad sides count.
        shares = {f"{'+' if sign > 0 else '-'}{'xyz'[axis]}": side_flat_share(mesh, axis, sign) for axis in range(3) for sign in (1, -1) if float(np.prod(np.delete(size, axis))) >= widest / 2}
        side = max(shares, key=shares.get)
        need = MIN_COVER_FLAT if name == "PRINT_Base" else MIN_PART_CONTACT
        fix = f"{name} has no side that sits flat on the print bed. Its flattest side, {side}, touches only {shares[side]:.0%} of its outline, and it needs {need:.0%}. "
        fix += "Make the rear cover a flat plate of even thickness, with its outside completely flat and only its outline rounded." if name == "PRINT_Base" else "Give it one flat face."
        results.append(result("flat_on_bed", name, shares[side] >= need, measured=round(shares[side], 3), limit=f"at least {need:.0%} of the outline touches the bed", where=f"flattest side {side}", fix=fix))
    return results


OUTER_SKIN_ALLOWANCE = 6.0
MAX_WRONG_OUTSIDE = 20.0


def check_outer_parts(meshes, front, body):
    """Only the Shell and the flat back of the rear cover may form the outside. A holder or stop showing through the wall prints, but shows as a patch. The outside is the frozen body's surface."""
    if "PRINT_Shell" not in meshes or body is None:
        return []
    back = -direction_vector(front)
    results = []
    for name, mesh in meshes.items():
        if name == "PRINT_Shell":
            continue
        points, faces = trimesh.sample.sample_surface(mesh, 5000, seed=5)
        _, distance, _ = trimesh.proximity.closest_point(body, points)
        on_outside = distance < 0.3
        allowed = np.zeros(len(points), dtype=bool)
        if name == "PRINT_Base":
            along = points @ back
            allowed = along >= along.max() - OUTER_SKIN_ALLOWANCE
        wrong = on_outside & ~allowed
        area = float(wrong.mean() * mesh.area)
        place = rounded(points[wrong][0]) if wrong.any() else None
        results.append(result("outer_parts", name, area <= MAX_WRONG_OUTSIDE, measured=round(area, 1), limit=f"at most {MAX_WRONG_OUTSIDE} mm2 of {name} on the outside, apart from the back of the cover", where=place,
                              fix=f"{name} shows on the outside of the case near {place}. The Shell must form the outside everywhere except the flat back. Keep holders, stops and other pieces inside, with the Shell's wall around them."))
    return results


def check_case(design, meshes, purchased, cards, transforms):
    case = design.get("case")
    if not isinstance(case, dict):
        return [result("case", "design.json", False, fix="design.json needs a case section with assembly and screws.")]
    missing = [n for n in REQUIRED_PARTS if n not in meshes]
    if missing:
        return [result("case", "design.json", False, measured=missing, limit=REQUIRED_PARTS, fix="A case is at least PRINT_Shell and PRINT_Base. The controller's holder may be built into one of them or be its own PRINT_Carrier.")]
    if not all(m.is_watertight for m in meshes.values()) or set(transforms) != set(purchased):
        return []
    results = check_plastic_pairs(meshes)
    results.extend(check_flat_on_bed(meshes))
    body_path = design.get("body_stl")
    results.extend(check_outer_parts(meshes, (design.get("base_design") or {}).get("front", "-y"), load_stl(body_path) if body_path else None))
    union = merged(meshes.values())
    part_points = {}
    for name, transform in transforms.items():
        part_id = purchased[name]["part_id"]
        part_points[name] = apply(transform, part_surface(part_id)[2])
        for mesh_name, mesh in meshes.items():
            gap, inside, where = clearance(mesh, part_id, transform)
            place = rounded(where) if where is not None else None
            results.append(result("clearance", f"{mesh_name} / {name}", gap >= MIN_GAP - GAP_TOLERANCE and inside == 0, measured=None if np.isinf(gap) else round(gap, 3), limit=f"at least {MIN_GAP} mm", where=f"at {place}, {inside} points inside the plastic",
                                  fix=f"{mesh_name} is too close to {name} at {place}. Move that surface away until the gap is at least {MIN_GAP} mm."))
        results.extend(allow_glue(check_retained(name, part_points[name], union), glueable(set((design.get("case") or {}).get("glued") or []), cards)))
        card = cards[name]
        if "usb" in card["features"]:
            room = port_room_box(card["features"]["usb"], transform)
            blocked = sum(overlap(m, room) for m in meshes.values())
            path = f"{rounded(room.bounds[0])} to {rounded(room.bounds[1])}"
            results.append(result("usb_access", name, blocked < 1e-3, measured=round(blocked, 3), limit="0 mm3 of plastic in the plug's path", where=f"plug path {path}", fix=f"Open every printed part in the plug's path, {path}."))
            desk = union.bounds[0][2]
            results.append(result("usb_above_desk", name, room.bounds[0][2] >= desk, measured=round(float(room.bounds[0][2] - desk), 2), limit="plug stays above the desk (0 or more)", where=f"plug path lowest z {room.bounds[0][2]:.2f}, desk z {desk:.2f}",
                                  fix="The plug would hit the desk. Turn the board so the USB faces sideways or backward, or raise it, so the whole plug path stays above the lowest point of the case."))
        if "screen" in card["features"] and "glass" in card["features"]:
            results.extend(check_screen(name, card, transform, union))
    if "PRINT_Carrier" in meshes:
        results.extend(check_retained("PRINT_Carrier", plastic_points(meshes["PRINT_Carrier"]), merged(m for n, m in meshes.items() if n != "PRINT_Carrier")))
    results.extend(check_standing(meshes))
    assembly_points = {}
    for name, points in part_points.items():
        keep = np.ones(len(points), dtype=bool)
        for feature in cards[name]["features"].values():
            if feature.get("fitted_last"):
                local = (points - transforms[name][:3, 3]) @ transforms[name][:3, :3]
                keep &= ~np.all((local >= np.array(feature["min"]) - 0.01) & (local <= np.array(feature["max"]) + 0.01), axis=1)
        assembly_points[name] = points[keep]
    snaps = case.get("snaps") or []
    results.extend(check_assembly(case.get("assembly") or [{}], trimmed_for_assembly(meshes, snaps), purchased, assembly_points))
    results.extend(check_snaps(snaps, meshes))
    results.extend(check_screws(case.get("screws") or [], meshes, part_points, case.get("snaps") or []))
    from wiring_checks import check_wiring
    results.extend(check_wiring(design, meshes, purchased, cards, transforms))
    from layout_checks import check_layout
    results.extend(check_layout(design, cards, transforms, union))
    if design.get("base_design", {}) and design["base_design"].get("use_library"):
        from access import check_access
        results.extend(check_access(design["base_design"]["parts"].split(","), meshes, cards, transforms))
    return results
