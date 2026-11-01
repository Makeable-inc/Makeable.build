"""Checks that a case matches its base design, plus two wiring checks that came from looking at a real result: wires must not cross and must not show from outside."""
import numpy as np
import trimesh

from card import DIRECTIONS
from checks import apply, direction_vector, load_stl, part_surface, port_room_box, result, rounded
from wiring_checks import WIRE_RADIUS

SAMPLE_STEP = 1.0
TILT = 0.06
BODY_TOLERANCE = 0.3
MIN_BODY_KEPT = 0.75
BUTTON_SIGHT_LENGTH = 80.0
KNOB_HOLE_SIGHT_RADIUS = 8.0
OUTWARD = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]


def sample_path(path):
    points = []
    path = np.array(path, dtype=float)
    for a, b in zip(path[:-1], path[1:]):
        count = max(int(np.linalg.norm(b - a) / SAMPLE_STEP), 1)
        points.extend(a + (b - a) * t for t in np.linspace(0, 1, count + 1))
    return np.array(points)


def named_paths(design):
    return {w["net"]: w["path"] for w in design.get("wires") or [] if isinstance(w, dict) and isinstance(w.get("path"), list) and len(w["path"]) >= 2 and "net" in w}


def check_wire_crossing(design):
    """Two wires need their full width between them, so a crossing or a tangle fails."""
    paths = {net: sample_path(path) for net, path in named_paths(design).items()}
    names = list(paths)
    results = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            distances = np.linalg.norm(paths[a][:, None] - paths[b][None], axis=2)
            at = np.unravel_index(np.argmin(distances), distances.shape)
            gap = float(distances[at])
            place = rounded(paths[a][at[0]])
            results.append(result("wire_crossing", f"{a} / {b}", gap >= WIRE_RADIUS * 2, measured=round(gap, 2), limit=f"at least {WIRE_RADIUS * 2} mm between wire centres", where=place,
                                  fix=f"Wires {a} and {b} cross or touch near {place}. Route the wires side by side in the same order at both ends, as a neat bundle."))
    return results


def tilted(direction):
    across = np.eye(3)[np.argsort(np.abs(direction))[:2]]
    rays = [direction] + [direction + sign * TILT * axis for axis in across for sign in (1, -1)]
    return [ray / np.linalg.norm(ray) for ray in rays]


def check_wire_hidden(design, union):
    """A wire that can see straight out of the case shows from outside, through a gap or an open hump."""
    results = []
    for net, path in named_paths(design).items():
        points = sample_path(path)
        seen = np.zeros(len(points), dtype=bool)
        for direction in OUTWARD:
            # A real opening lets slightly tilted sight lines out too. A sight line running exactly along a thin seam gap does not count.
            escapes = np.ones(len(points), dtype=bool)
            for ray in tilted(np.array(direction, dtype=float)):
                escapes &= ~union.ray.intersects_any(points, np.tile(ray, (len(points), 1)))
            seen |= escapes
        place = rounded(points[seen].mean(axis=0)) if seen.any() else None
        results.append(result("wire_hidden", net, not seen.any(), measured=int(seen.sum()), limit="no point on a wire can see straight out of the case", where=place,
                              fix=f"Wire {net} shows from outside near {place}. Close that opening or route the wire behind plastic. Only the USB, knob and button holes may be open, and they must not line up with a wire."))
    return results


def world_box(feature, transform):
    low, high = np.array(feature["min"]), np.array(feature["max"])
    corners = np.array([[x, y, z] for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])])
    return apply(transform, corners)


def check_base_design(base, cards, transforms, union):
    """The case must keep the layout that was decided before any CAD was written."""
    results = []
    front = base["front"]
    front_vector = direction_vector(front)
    axis = DIRECTIONS[front][0]
    across_axis, up_axis = [i for i in range(3) if i != axis][0], 2
    low, high = union.bounds
    size = high - low

    ratio = float(size[across_axis] / size[up_axis])
    wanted = base.get("width_to_height")
    if wanted:
        results.append(result("base_proportion", "case", wanted[0] <= ratio <= wanted[1], measured=round(ratio, 2), limit=f"case width / height from {wanted[0]} to {wanted[1]}", where=f"case {np.round(size, 1).tolist()} mm",
                              fix=f"The base design wants the front's width / height from {wanted[0]} to {wanted[1]}. It is {ratio:.2f}. Change the body's outline, not the layout."))
    if base.get("max_depth"):
        results.append(result("base_depth", "case", size[axis] <= base["max_depth"], measured=round(float(size[axis]), 1), limit=f"at most {base['max_depth']} mm deep", where=None,
                              fix=f"The base design allows {base['max_depth']} mm of depth, and the case is {size[axis]:.1f} mm. Tighten the inside layout."))

    for name, rule in base.get("place", {}).items():
        if name not in transforms or rule["feature"] not in cards[name]["features"]:
            results.append(result("base_place", name, False, measured=rule["feature"], fix=f"The base design needs {name} with a {rule['feature']} feature."))
            continue
        transform = transforms[name]
        corners = world_box(cards[name]["features"][rule["feature"]], transform)
        share = float((corners[:, across_axis].mean() - low[across_axis]) / size[across_axis])
        lo, hi = rule["across"]
        results.append(result("base_place", f"{name} {rule['feature']}", lo <= share <= hi, measured=round(share, 2), limit=f"centre from {lo} to {hi} across the front, measured from the {'-' if across_axis == 0 else ''}{'xyz'[across_axis]} side", where=rounded(corners.mean(axis=0)),
                              fix=f"The base design puts {rule['feature']} from {lo} to {hi} across the front. Move it there and keep the layout."))
        facing = transform[:3, :3] @ direction_vector(cards[name]["front"])
        results.append(result("base_facing", f"{name} {rule['feature']}", float(facing @ front_vector) > 0.99, measured=np.round(facing, 2).tolist(), limit=f"faces {front}", where=None,
                              fix=f"The base design has {rule['feature']} on the {front} face. Turn {name} so its {cards[name]['front']} side faces {front}."))

    if base.get("usb_side"):
        for name, card in cards.items():
            if name in transforms and "usb" in card["features"]:
                opens = transforms[name][:3, :3] @ direction_vector(card["features"]["usb"]["opens_toward"])
                wanted_side = direction_vector(base["usb_side"])
                results.append(result("base_usb", name, float(opens @ wanted_side) > 0.99, measured=np.round(opens, 2).tolist(), limit=f"USB opens toward {base['usb_side']}", where=None,
                                      fix=f"The base design has the USB opening toward {base['usb_side']}. Turn the board to match."))
    return results


def planned_openings(cards, transforms):
    """The holes a design is meant to have. Seeing a wire through one of these is normal, so they count as closed for the wire check."""
    openings = []
    for name, card in cards.items():
        if name not in transforms:
            continue
        if "usb" in card["features"]:
            openings.append(port_room_box(card["features"]["usb"], transforms[name]))
        for button in card.get("buttons") or []:
            center = (np.array(button["min"]) + np.array(button["max"])) / 2
            direction = transforms[name][:3, :3] @ direction_vector(button["press_from"])
            start = apply(transforms[name], center[None])[0]
            openings.append(trimesh.creation.cylinder(radius=2.5, height=BUTTON_SIGHT_LENGTH, transform=trimesh.geometry.align_vectors([0, 0, 1], direction)).apply_translation(start + direction * BUTTON_SIGHT_LENGTH / 2))
        if "shaft" in card["features"]:
            shaft = card["features"]["shaft"]
            direction = transforms[name][:3, :3] @ direction_vector(card["front"])
            center = apply(transforms[name], ((np.array(shaft["min"]) + np.array(shaft["max"])) / 2)[None])[0]
            openings.append(trimesh.creation.cylinder(radius=KNOB_HOLE_SIGHT_RADIUS, height=BUTTON_SIGHT_LENGTH, transform=trimesh.geometry.align_vectors([0, 0, 1], direction)).apply_translation(center))
    return openings


def check_body_kept(body_path, union):
    """The case may cut into the frozen body but must not grow past it or lose its form."""
    body = load_stl(body_path)
    points = np.vstack([trimesh.sample.sample_surface(union, 20000, seed=4)[0], union.vertices])
    outside = points[~body.contains(points)]
    results = []
    if len(outside):
        _, distance, _ = trimesh.proximity.closest_point(body, outside)
        worst = float(distance.max())
        place = rounded(outside[int(np.argmax(distance))])
    else:
        worst, place = 0.0, None
    results.append(result("body_no_growth", "case", worst <= BODY_TOLERANCE, measured=round(worst, 3), limit=f"nothing more than {BODY_TOLERANCE} mm outside the frozen body", where=place,
                          fix=f"Plastic stands {worst:.2f} mm outside the frozen body near {place}. Remove it; the body cannot change."))
    samples = trimesh.sample.sample_surface(body, 20000, seed=5)[0]
    _, distance, _ = trimesh.proximity.closest_point(union, samples)
    kept = float((distance <= BODY_TOLERANCE).mean())
    results.append(result("body_kept", "case", kept >= MIN_BODY_KEPT, measured=round(kept, 3), limit=f"at least {MIN_BODY_KEPT} of the frozen body's surface kept", where=None,
                          fix=f"Only {kept:.0%} of the frozen body's outside survives. Keep cuts to the window, knob, USB and screw holes and the seam."))
    return results


def check_layout(design, cards, transforms, union):
    # The parts block the view too: a wire behind the board is not visible through the window.
    parts = [part_surface(design["purchased"][n]["part_id"])[0].copy().apply_transform(transforms[n]) for n in transforms]
    walls = trimesh.util.concatenate([union] + parts + planned_openings(cards, transforms))
    results = check_wire_crossing(design) + check_wire_hidden(design, walls)
    if design.get("body_stl"):
        results.extend(check_body_kept(design["body_stl"], union))
    base = design.get("base_design")
    if base:
        results.extend(check_base_design(base, cards, transforms, union))
    return results
