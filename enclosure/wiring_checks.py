"""Fixed checks for several parts joined by wires: plug room, wire routes, side buttons and a touch sensor opening. Wires come from the compiler, never from the design."""
import hashlib
import json
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import ConvexHull, QhullError, cKDTree

from part_variants import BEND_HEIGHT, VARIANTS, base_of
from card import DIRECTIONS, build_card
from case_checks import cylinder, merged, overlap
from checks import AXES, apply, direction_vector, part_surface, port_room_box, result, rounded, travel

HERE = Path(__file__).resolve().parent
# Assumptions, none measured on real hardware. Replace them when real jumpers and a printed test piece have been measured.
PLUG = {"width": 2.5, "length": 14.0, "over_pin": 6.0}
WIRE_RADIUS = 0.8
WIRE_BEND_RADIUS = 4.0
WIRE_MAX_LENGTH = 200.0
WIRE_REACH = 1.0
FINGER_WIDTH = 10.0
FINGER_MAX_DEPTH = 4.0
FINGER_CLEAR_LENGTH = 30.0
KNOB_EXPOSED = 8.0
KNOB_FINGER_ROOM = 5.0
KNOB_ROOM_ABOVE = 5.0
KNOB_WALL_RING = 1.5
PRESS_MAX_GAP = 0.5
PRESS_SUPPORT_MARGIN = 1.0
PRESS_WIRE_DEPTH = 3.0
BUTTON_POKE_RADIUS = 1.0
BUTTON_POKE_LENGTH = 60.0
SAMPLE_STEP = 0.5


def wires_for(part_ids):
    """The compiler's wires for these parts, with the controller first. Saved, because the compiler's answer only changes with the parts."""
    folder = HERE / ".cache" / "wires"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{hashlib.sha256(' '.join(part_ids).encode()).hexdigest()[:16]}.json"
    if not path.exists():
        done = subprocess.run(["node", str(HERE / "wires.mjs"), *[base_of(i) for i in part_ids]], capture_output=True, text=True, timeout=120, check=True)
        json.loads(done.stdout)
        path.write_text(done.stdout, encoding="utf-8")
    wires = json.loads(path.read_text(encoding="utf-8"))
    named = {base_of(i): i for i in part_ids}
    for wire in wires:
        for end in (wire["from"], wire["to"]):
            end["part_id"] = named.get(end["part_id"], end["part_id"])
            if end["part_id"] in VARIANTS:
                # The compiler's point is on the upright pin's tip; the bent pin runs at the bend height.
                end["position"][2] = BEND_HEIGHT
    return wires


@lru_cache(maxsize=32)
def card_for(part_id):
    return build_card(part_id)


def pin_direction(end):
    """The way the pin really points. A card can override the compiler when the AWS model disagrees with it, because the AWS model is the truth."""
    override = card_for(end["part_id"]).get("pins_point")
    return direction_vector(override) if override else np.array(end["normal"], dtype=float)


def pin_tip(end):
    """How far the real pin reaches along its own direction, measured from the AWS model, because the compiler's point can be partway along it."""
    points = part_surface(end["part_id"])[1]
    position, normal = np.array(end["position"], dtype=float), pin_direction(end)
    along = (points - position) @ normal
    radial = np.linalg.norm((points - position) - np.outer(along, normal), axis=1)
    near = radial < 0.6
    return position + normal * (float(along[near].max()) if near.any() else 0.0)


def plug_local(end):
    """The plug on this pin, in the part's own coordinates: where it starts on the pin and where its back end is, which is where the wire leaves."""
    normal = pin_direction(end)
    tip = pin_tip(end)
    start = tip - normal * PLUG["over_pin"]
    return {"start": start, "back": start + normal * PLUG["length"], "normal": normal}


def plug_box(plug, transform):
    middle = (plug["start"] + plug["back"]) / 2
    axis = int(np.argmax(np.abs(plug["normal"])))
    extents = [PLUG["width"]] * 3
    extents[axis] = PLUG["length"]
    box = trimesh.creation.box(extents=extents, transform=trimesh.transformations.translation_matrix(middle))
    box.apply_transform(transform)
    return box


def path_samples(path):
    points = []
    for a, b in zip(path[:-1], path[1:]):
        count = max(2, int(np.linalg.norm(b - a) / SAMPLE_STEP) + 1)
        points.append(a + np.linspace(0, 1, count)[:, None] * (b - a))
    return np.vstack(points)


def tightest_bend(path):
    """A wire can follow a corner only if both segments are long enough to hold a curve of the minimum radius. Returns the shortfall in mm and where."""
    worst, where = 0.0, None
    for i in range(1, len(path) - 1):
        one, two = path[i] - path[i - 1], path[i + 1] - path[i]
        length_one, length_two = np.linalg.norm(one), np.linalg.norm(two)
        if length_one < 1e-6 or length_two < 1e-6:
            continue
        cosine = np.clip(one @ two / (length_one * length_two), -1, 1)
        needed = WIRE_BEND_RADIUS * np.tan(np.arccos(cosine) / 2) if cosine > -0.999 else np.inf
        shortfall = needed - min(length_one, length_two)
        if shortfall > worst:
            worst, where = float(shortfall), path[i]
    return worst, where


def check_wire(net, ends, declared, meshes, union, hull, part_points, usb_rooms):
    results = []
    label = f"wire {net}"
    if declared is None:
        return [result("wire_route", label, False, limit="one route for each wire from the compiler", fix=f"Add {net} to design.json wires, with a path from one plug's back end to the other's.")]
    try:
        path = np.array(declared, dtype=float)
        if path.ndim != 2 or path.shape[1] != 3 or len(path) < 2:
            raise ValueError
    except (TypeError, ValueError):
        return [result("wire_route", label, False, measured=str(declared)[:100], limit="a list of at least 2 [x, y, z] points", fix=f"Give {net} a path as a list of [x, y, z] points.")]
    results.append(result("wire_route", label, True))

    first, second = ends
    if np.linalg.norm(path[0] - second["back"]) + np.linalg.norm(path[-1] - first["back"]) < np.linalg.norm(path[0] - first["back"]) + np.linalg.norm(path[-1] - second["back"]):
        path = path[::-1]
    miss = max(np.linalg.norm(path[0] - first["back"]), np.linalg.norm(path[-1] - second["back"]))
    results.append(result("wire_reach", label, miss <= WIRE_REACH, measured=round(float(miss), 2), limit=f"both ends within {WIRE_REACH} mm of a plug's back end", where=f"plug backs {rounded(first['back'])} and {rounded(second['back'])}",
                          fix=f"Start {net}'s path exactly at {rounded(first['back'])} and end it at {rounded(second['back'])}."))
    if miss > WIRE_REACH:
        return results

    # The wire leaves each plug straight along the pin, so the plug counts as the segment before the first corner.
    full = np.vstack([first["back"] - first["normal"] * 100, path, second["back"] - second["normal"] * 100])
    shortfall, where = tightest_bend(full)
    results.append(result("wire_bend", label, shortfall <= 0, measured=round(shortfall, 2), limit=f"every corner can hold a {WIRE_BEND_RADIUS} mm radius (assumed)", where=None if where is None else rounded(where),
                          fix=f"The corner at {None if where is None else rounded(where)} is too tight for a {WIRE_BEND_RADIUS} mm bend, by {shortfall:.1f} mm. Lengthen the segments next to it or make the turn gentler, including where the wire leaves the plug along the pin."))

    samples = path_samples(path)
    length = float(np.linalg.norm(np.diff(path, axis=0), axis=1).sum())
    results.append(result("wire_length", label, length <= WIRE_MAX_LENGTH, measured=round(length, 1), limit=f"at most {WIRE_MAX_LENGTH} mm", fix=f"Shorten {net}'s route to fit a {WIRE_MAX_LENGTH} mm jumper."))
    _, distances, _ = trimesh.proximity.closest_point(union, samples)
    inside = union.contains(samples)
    worst = int(np.argmax(inside.astype(float) * 1000 - distances))
    results.append(result("wire_clear_plastic", label, not inside.any() and distances.min() >= WIRE_RADIUS, measured=round(float(-distances[worst] if inside[worst] else distances[worst]), 2), limit=f"wire centre at least {WIRE_RADIUS} mm from plastic", where=rounded(samples[worst]),
                          fix=f"{net} runs into or too close to plastic near {rounded(samples[worst])}. Route it through open space, or open the plastic there."))
    closest = np.inf
    place, owner = None, None
    for name, points in part_points.items():
        nearest, indexes = cKDTree(points).query(samples)
        i = int(np.argmin(nearest))
        if nearest[i] < closest:
            closest, place, owner = float(nearest[i]), samples[i], name
    results.append(result("wire_clear_parts", label, closest >= WIRE_RADIUS, measured=round(closest, 2), limit=f"wire centre at least {WIRE_RADIUS} mm from every part", where=rounded(place),
                          fix=f"{net} runs through {owner} near {rounded(place)}. Route it around."))
    outside = ~hull.contains(samples)
    results.append(result("wire_inside", label, not outside.any(), measured=int(outside.sum()), limit="the whole route stays inside the case", where=rounded(samples[outside][0]) if outside.any() else None,
                          fix=f"{net} leaves the case near {rounded(samples[outside][0]) if outside.any() else None}. Keep its whole route inside."))
    in_room = any(room.contains(samples).any() for room in usb_rooms)
    results.append(result("wire_clear_usb", label, not in_room, limit="not in the USB plug's path", fix=f"{net} crosses the USB plug's path. Route it around."))
    return results


def check_button(name, index, button, transform, meshes):
    axis, side = DIRECTIONS[button["press_from"]]
    outward = transform[:3, :3] @ direction_vector(button["press_from"])
    center = (np.array(button["min"]) + np.array(button["max"])) / 2
    center[axis] = button["max" if side else "min"][axis]
    start = apply(transform, center[None])[0]
    blocked = sum(overlap(m, cylinder(BUTTON_POKE_RADIUS, start + outward * 0.01, outward, BUTTON_POKE_LENGTH)) for m in meshes.values())
    place = rounded(start)
    return result("button_reach", f"{name} button {index + 1}", blocked < 1e-3, measured=round(blocked, 2), limit=f"a clear {BUTTON_POKE_RADIUS * 2} mm hole straight out of the case (assumed)", where=place,
                  fix=f"Open a {BUTTON_POKE_RADIUS * 2} mm hole from the button at {place}, straight out through every printed part, in world direction {np.round(outward, 2).tolist()}.")


def check_touch(name, card, transform, meshes, union, part_points, screen_normal):
    """The touch sensor gets a real opening: no plastic or part over the middle of its touch area, plastic still around it, shallow enough for a finger, and somewhere a person can see."""
    touch, pcb = card["features"]["touch"], card["features"]["pcb"]
    center = (np.array(touch["min"]) + np.array(touch["max"])) / 2
    options = []
    for side_name in touch["may_face_out"]:
        axis, side = DIRECTIONS[side_name]
        u_axis, v_axis = [i for i in range(3) if i != axis]
        face = center.copy()
        face[axis] = pcb["max" if side else "min"][axis]
        start = apply(transform, face[None])[0]
        ray = transform[:3, :3] @ direction_vector(side_name)
        blocked = sum(overlap(m, cylinder(FINGER_WIDTH / 2, start + ray * 0.01, ray, FINGER_CLEAR_LENGTH)) for m in meshes.values())
        in_the_way = 0
        for points in part_points.values():
            along = (points - start) @ ray
            radial = np.linalg.norm((points - start) - np.outer(along, ray), axis=1)
            in_the_way += int(((along > 0.01) & (along < FINGER_CLEAR_LENGTH) & (radial < FINGER_WIDTH / 2)).sum())
        # Walking out from the opening in each direction: the first plastic met is the rim. Reaching the sensor's edge without any means the opening is bigger than the sensor.
        depth, beyond = 0.0, 0
        for angle in np.linspace(0, 2 * np.pi, 16, endpoint=False):
            found = False
            for radius in np.arange(FINGER_WIDTH / 2 + 0.25, 30, 0.5):
                point = face.copy()
                point[u_axis] += radius * np.cos(angle)
                point[v_axis] += radius * np.sin(angle)
                if not (pcb["min"][u_axis] <= point[u_axis] <= pcb["max"][u_axis] and pcb["min"][v_axis] <= point[v_axis] <= pcb["max"][v_axis]):
                    break
                origin = apply(transform, point[None])[0]
                hits, _, _ = union.ray.intersects_location(origin[None], ray[None], multiple_hits=True)
                if len(hits):
                    depth = max(depth, float(((hits - origin) @ ray).max()))
                    found = True
                    break
            beyond += 0 if found else 1
        options.append({"side": side_name, "blocked": float(blocked), "in_the_way": in_the_way, "depth": depth, "beyond": beyond, "ray": ray, "start": start})
    # The side nearest the outside is the one facing out. The other side points into the case.
    best = min(options, key=lambda o: o["depth"])
    place = rounded(best["start"])
    direction = np.round(best["ray"], 2).tolist()
    where = f"{best['side']} side faces out, opening centred at {place}, world direction {direction}"
    faces_person = best["ray"][2] > -0.5 and (screen_normal is None or best["ray"] @ screen_normal > -0.5)
    return [
        result("touch_opening", name, best["blocked"] < 1e-3 and best["in_the_way"] == 0, measured=f"{best['blocked']:.2f} mm3 plastic, {best['in_the_way']} part points", limit=f"a clear {FINGER_WIDTH} mm wide opening over the middle of the touch area (assumed size)", where=where,
               fix=f"Cut a clear {FINGER_WIDTH} mm wide opening straight out from {place} in world direction {direction}, through every printed part, with no part in the way."),
        result("touch_rim", name, best["beyond"] == 0, measured=f"{best['beyond']} of 16 directions have no plastic before the sensor's edge", limit="plastic all round the opening, inside the sensor's outline", where=where,
               fix=f"The opening is bigger than the sensor at {place}. Keep it inside the sensor's outline so plastic still holds the sensor in."),
        result("touch_depth", name, best["depth"] <= FINGER_MAX_DEPTH, measured=round(best["depth"], 2), limit=f"at most {FINGER_MAX_DEPTH} mm from the sensor's face to the outside at the rim (assumed)", where=where,
               fix=f"The opening at {place} is too deep for a finger. Bring the sensor closer to the outside or thin the wall at the rim, to at most {FINGER_MAX_DEPTH} mm."),
        result("touch_place", name, faces_person, measured=direction, limit="not on the desk side, and not on the far side from the screen", where=where,
               fix="Put the touch opening where a person can see and reach it: the front, top or a side, and not underneath or behind."),
    ]


def check_knob(name, card, transform, meshes, union, other_points, wire_paths, screen_normal):
    """A knob on a shaft: through a real hole, with finger room outside, on a side a person can reach, and pressing it pushes against plastic and not a wire."""
    features = card["features"]
    shaft, knob, bushing, pcb = features["shaft"], features["knob"], features["bushing"], features["pcb"]
    axis, side = DIRECTIONS[shaft["points"]]
    u_axis, v_axis = [i for i in range(3) if i != axis]
    center = (np.array(shaft["min"]) + np.array(shaft["max"])) / 2
    outward_local = direction_vector(shaft["points"])
    outward = transform[:3, :3] @ outward_local
    knob_top = knob["max" if side else "min"][axis]
    sign = 1 if side else -1
    results = []

    # A ring of rays just outside the bushing, from where the shaft leaves the can up to the knob: all must meet plastic, or there is no wall around the shaft.
    start_level = features["can"]["max" if side else "min"][axis]
    knob_base = knob["min" if side else "max"][axis]
    radius = bushing["size"][u_axis] / 2 + KNOB_WALL_RING
    missing = 0
    for angle in np.linspace(0, 2 * np.pi, 12, endpoint=False):
        point = center.copy()
        point[axis] = start_level
        point[u_axis] += radius * np.cos(angle)
        point[v_axis] += radius * np.sin(angle)
        distance, _ = travel(union, apply(transform, point[None]), outward)
        if distance > abs(knob_base - start_level):
            missing += 1
    axis_point = center.copy()
    axis_point[axis] = start_level
    axis_hit, _ = travel(union, apply(transform, axis_point[None]), outward)
    place = rounded(apply(transform, axis_point[None])[0])
    direction = np.round(outward, 2).tolist()
    results.append(result("shaft_hole", name, missing == 0 and np.isinf(axis_hit), measured=f"{missing} of 12 directions have no wall, shaft path {'clear' if np.isinf(axis_hit) else 'blocked'}", limit=f"a wall all round the shaft, within {KNOB_WALL_RING} mm of the bushing and below the knob, and a clear shaft path", where=f"shaft from {place}, world direction {direction}",
                          fix=f"Make a closed hole for the shaft in a wall, from {place} in world direction {direction}: plastic all round the bushing, up to {KNOB_WALL_RING} mm from it, at a level below the knob's base. The hole may be split across a seam."))

    # Finger room around the top of the knob. The whole band must be free of plastic and parts.
    knob_radius = max(knob["size"][u_axis], knob["size"][v_axis]) / 2
    knob_center = (np.array(knob["min"]) + np.array(knob["max"])) / 2
    band_start = knob_center.copy()
    band_start[axis] = knob_top - sign * KNOB_EXPOSED
    start_world = apply(transform, band_start[None])[0]
    room_radius = knob_radius + KNOB_FINGER_ROOM
    room_length = KNOB_EXPOSED + KNOB_ROOM_ABOVE
    blocked = sum(overlap(m, cylinder(room_radius, start_world, outward, room_length)) for m in meshes.values())
    in_room = 0
    for points in other_points.values():
        along = (points - start_world) @ outward
        off_axis = np.linalg.norm((points - start_world) - np.outer(along, outward), axis=1)
        in_room += int(((along > 0) & (along < room_length) & (off_axis < room_radius)).sum())
    results.append(result("knob_room", name, blocked < 1e-3 and in_room == 0, measured=f"{blocked:.1f} mm3 plastic, {in_room} part points", limit=f"the top {KNOB_EXPOSED} mm of the knob stands clear, with {KNOB_FINGER_ROOM} mm finger room all round (assumed)", where=f"room is {room_radius * 2} mm wide, from {rounded(start_world)} for {room_length} mm in world direction {direction}",
                          fix=f"Fingers cannot grip the knob. Keep a clear space {room_radius * 2} mm wide, from {rounded(start_world)} for {room_length} mm in world direction {direction}. Move the knob's wall lower here, for example with a recess around the knob, or move the shaft to another wall."))

    faces_person = outward[2] > -0.5 and (screen_normal is None or outward @ screen_normal > -0.5)
    results.append(result("knob_place", name, faces_person, measured=direction, limit="not on the desk side, and not on the far side from the screen", where=place,
                          fix="Bring the shaft out where a person can reach it: the front, top or a side, and not underneath or behind."))

    # Pressing the knob pushes the board straight back. Plastic close behind the board must surround the shaft, or it tips.
    rear = pcb["min" if side else "max"][axis]
    us = np.arange(pcb["min"][u_axis], pcb["max"][u_axis] + 0.01, 1.0)
    vs = np.arange(pcb["min"][v_axis], pcb["max"][v_axis] + 0.01, 1.0)
    grid = np.zeros((len(us) * len(vs), 3))
    grid[:, u_axis], grid[:, v_axis] = [g.ravel() for g in np.meshgrid(us, vs, indexing="ij")]
    grid[:, axis] = rear
    origins = apply(transform, grid)
    hits, rays, _ = union.ray.intersects_location(origins, np.tile(-outward, (len(origins), 1)), multiple_hits=False)
    close = rays[np.linalg.norm(hits - origins[rays], axis=1) <= PRESS_MAX_GAP] if len(hits) else np.zeros(0, dtype=int)
    margin, support = -np.inf, len(close)
    if len(close) >= 3:
        try:
            hull = ConvexHull(grid[close][:, [u_axis, v_axis]])
            margin = float(-np.max(hull.equations[:, :2] @ center[[u_axis, v_axis]] + hull.equations[:, 2]))
        except QhullError:
            margin = -np.inf
    results.append(result("press_stop", name, margin >= PRESS_SUPPORT_MARGIN, measured=f"{support} supported points, shaft {'not inside them' if not np.isfinite(margin) or margin < 0 else f'{margin:.1f} mm inside them'}", limit=f"plastic within {PRESS_MAX_GAP} mm behind the board, surrounding the shaft by at least {PRESS_SUPPORT_MARGIN} mm", where=place,
                          fix=f"Pressing the knob pushes {name} straight back. Add plastic stops within {PRESS_MAX_GAP} mm behind its PCB, on both sides of the shaft, avoiding the solder tails and pins. Stops only on one side would let it tip."))

    pressed = 0
    local_low, local_high = np.array(pcb["min"]), np.array(pcb["max"])
    for path in wire_paths:
        samples = path_samples(np.array(path, dtype=float))
        local = (samples - transform[:3, 3]) @ transform[:3, :3]
        behind = sign * (rear - local[:, axis])
        pressed += int(((behind > 0) & (behind < PRESS_WIRE_DEPTH) & (local[:, u_axis] > local_low[u_axis]) & (local[:, u_axis] < local_high[u_axis]) & (local[:, v_axis] > local_low[v_axis]) & (local[:, v_axis] < local_high[v_axis])).sum())
    results.append(result("press_not_on_wire", name, pressed == 0, measured=pressed, limit=f"no wire within {PRESS_WIRE_DEPTH} mm behind the board", where=place,
                          fix=f"A wire runs right behind {name}, so pressing the knob would crush it. Route it around, or keep it more than {PRESS_WIRE_DEPTH} mm behind the PCB."))
    return results


def wire_colours(wires):
    """Each wire's colour from the compiler. When the compiler gives two wires the same colour, the later one takes the next free colour, so different wires always read as different colours."""
    spare = ["#f2cc3d", "#e67e22", "#9b59b6", "#16a085", "#e84393", "#ffffff", "#8d6e63"]
    used, colours = set(), {}
    for wire in wires:
        colour = wire.get("color") or spare[0]
        if str(colour).lower() in used:
            colour = next(c for c in spare if c not in used)
        used.add(str(colour).lower())
        colours[wire["net"]] = colour
    return colours


def check_wiring(design, meshes, purchased, cards, transforms):
    results = []
    union = merged(meshes.values())
    all_points = {n: apply(transforms[n], part_surface(purchased[n]["part_id"])[1]) for n in transforms}
    screen_normal = None
    for name, card in cards.items():
        if name in transforms and "screen" in card["features"]:
            screen_normal = transforms[name][:3, :3] @ direction_vector(card["front"])
    for name, card in cards.items():
        if name not in transforms:
            continue
        for index, button in enumerate(card.get("buttons") or []):
            results.append(check_button(name, index, button, transforms[name], meshes))
        if "touch" in card["features"]:
            others = {n: p for n, p in all_points.items() if n != name}
            results.extend(check_touch(name, card, transforms[name], meshes, union, others, screen_normal))
        if "shaft" in card["features"]:
            others = {n: p for n, p in all_points.items() if n != name}
            paths = [w.get("path") for w in design.get("wires") or [] if isinstance(w, dict) and isinstance(w.get("path"), list) and len(w["path"]) >= 2]
            results.extend(check_knob(name, card, transforms[name], meshes, union, others, paths, screen_normal))
    if len(purchased) < 2:
        return results

    controllers = [n for n in purchased if cards[n].get("role") == "controller"]
    if len(controllers) != 1 or set(transforms) != set(purchased):
        return results + [result("wire_route", "case", False, measured=controllers, limit="exactly one controller", fix="Use exactly one controller board.")]
    ids = [purchased[controllers[0]]["part_id"]] + [purchased[n]["part_id"] for n in purchased if n != controllers[0]]
    wires = wires_for(ids)
    name_of = {purchased[n]["part_id"]: n for n in purchased}
    declared = {w.get("net"): w.get("path") for w in design.get("wires") or [] if isinstance(w, dict)}
    hull = union.convex_hull
    part_points = all_points
    usb_rooms = [port_room_box(cards[n]["features"]["usb"], transforms[n]) for n in purchased if "usb" in cards[n]["features"]]
    for wire in wires:
        ends = []
        for end in (wire["from"], wire["to"]):
            owner = name_of[end["part_id"]]
            transform = transforms[owner]
            local = plug_local(end)
            box = plug_box(local, transform)
            label = f"{owner} pin {end['label']}"
            blocked = sum(overlap(m, box) for m in meshes.values())
            results.append(result("plug_room", label, blocked < 1e-3, measured=round(blocked, 2), limit=f"0 mm3 of plastic in the {PLUG['width']} x {PLUG['width']} x {PLUG['length']} mm plug (assumed)", where=f"plug {rounded(box.bounds[0])} to {rounded(box.bounds[1])}",
                                  fix=f"Keep plastic out of the plug on {label}, {rounded(box.bounds[0])} to {rounded(box.bounds[1])}."))
            outside = ~hull.contains(box.vertices)
            results.append(result("plug_inside", label, not outside.any(), measured=int(outside.sum()), limit="the whole plug stays inside the case", where=f"plug {rounded(box.bounds[0])} to {rounded(box.bounds[1])}",
                                  fix=f"The plug on {label} sticks out of the case. Turn the part so its pins point into the case, or make room."))
            for other, points in part_points.items():
                if other != owner:
                    hit = box.contains(points)
                    results.append(result("plug_clear_parts", f"{label} / {other}", not hit.any(), measured=int(hit.sum()), limit="no other part inside the plug", where=f"plug {rounded(box.bounds[0])} to {rounded(box.bounds[1])}",
                                          fix=f"The plug on {label} runs into {other}. Move one of them."))
            ends.append({"back": apply(transform, local["back"][None])[0], "normal": transform[:3, :3] @ local["normal"]})
        results.extend(check_wire(wire["net"], ends, declared.get(wire["net"]), meshes, union, hull, part_points, usb_rooms))
    return results
