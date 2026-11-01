"""Checks on open space, not exact shapes: every opening is only as big as what it is for, and real floppy wires have a connected space to live in. All sizes below are assumptions until a real print and real jumpers are measured."""
from collections import deque
from functools import lru_cache

import numpy as np
import trimesh
from scipy import ndimage
from scipy.spatial import cKDTree

from card import DIRECTIONS, load_nodes
from case_checks import MAX_WINDOW_GAP, SCREW, cylinder, merged
from checks import apply, direction_vector, part_surface, port_room_box, result, rounded, thin_out
from parts import ensure_part
from wiring_checks import KNOB_WALL_RING, PLUG, WIRE_RADIUS, plug_box, plug_local, wires_for

PITCH = 1.0
CORRIDOR_LENGTH = 80.0
BUTTON_HOLE_DIAMETER = 3.0
USB_BEHIND_MOUTH = 8.0
MAX_VISIBLE_POINTS = 3
TILT = 0.06
OUTWARD = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
JUMPER_LENGTHS = (100.0, 150.0, 200.0)
BUNDLE_PACKING = 0.3
WIRE_SEED_REACH = 4.0
# These sit outside the case by design, so seeing them from outside says nothing about an opening.
OUTSIDE_FEATURES = ("knob", "shaft", "bushing")


def local_box_corridor(low, high, transform):
    low, high = np.array(low, dtype=float), np.array(high, dtype=float)
    box = trimesh.creation.box(extents=high - low, transform=trimesh.transformations.translation_matrix((low + high) / 2))
    box.apply_transform(transform)
    return box


def opening_corridors(design, cards, transforms):
    """The only places the case may be open, each sized from its part: window, USB plug, knob bushing, button pin hole and screwdriver path."""
    corridors = []
    for name, card in cards.items():
        if name not in transforms:
            continue
        transform, features = transforms[name], card["features"]
        if "glass" in features:
            axis, side = DIRECTIONS[card["front"]]
            low, high = np.array(features["glass"]["min"], dtype=float), np.array(features["glass"]["max"], dtype=float)
            others = [i for i in range(3) if i != axis]
            low[others] -= MAX_WINDOW_GAP
            high[others] += MAX_WINDOW_GAP
            if side:
                high[axis] += CORRIDOR_LENGTH
            else:
                low[axis] -= CORRIDOR_LENGTH
            corridors.append(("window", local_box_corridor(low, high, transform)))
        if "usb" in features:
            usb = features["usb"]
            room = port_room_box(usb, transform)
            axis, side = DIRECTIONS[usb["opens_toward"]]
            outward = transform[:3, :3] @ direction_vector(usb["opens_toward"])
            world_axis = int(np.argmax(np.abs(outward)))
            low, high = room.bounds[0].copy(), room.bounds[1].copy()
            if outward[world_axis] > 0:
                low[world_axis] -= USB_BEHIND_MOUTH
            else:
                high[world_axis] += USB_BEHIND_MOUTH
            corridors.append(("USB", local_box_corridor(low, high, np.eye(4))))
        if "shaft" in features:
            shaft, bushing = features["shaft"], features["bushing"]
            axis, side = DIRECTIONS[shaft["points"]]
            others = [i for i in range(3) if i != axis]
            center = (np.array(bushing["min"]) + np.array(bushing["max"])) / 2
            center[axis] = features["can"]["max" if side else "min"][axis]
            outward = transform[:3, :3] @ direction_vector(shaft["points"])
            radius = max(bushing["size"][i] for i in others) / 2 + KNOB_WALL_RING
            corridors.append(("knob", cylinder(radius, apply(transform, center[None])[0], outward, CORRIDOR_LENGTH)))
        for button in card.get("buttons") or []:
            axis, side = DIRECTIONS[button["press_from"]]
            center = (np.array(button["min"]) + np.array(button["max"])) / 2
            center[axis] = button["max" if side else "min"][axis]
            outward = transform[:3, :3] @ direction_vector(button["press_from"])
            corridors.append(("button", cylinder(BUTTON_HOLE_DIAMETER / 2, apply(transform, center[None])[0] - outward * 2, outward, CORRIDOR_LENGTH)))
    for screw in (design.get("case") or {}).get("screws") or []:
        try:
            head, outward = np.array(screw["head_at"], dtype=float), direction_vector(screw["drive_from"])
        except (KeyError, TypeError, ValueError):
            continue
        corridors.append(("screwdriver", cylinder(SCREW["driver_radius"], head, outward, SCREW["driver_length"])))
        corridors.append(("screw", cylinder(SCREW["shank_radius"], head, -outward, SCREW["length"])))
    return corridors


@lru_cache(maxsize=16)
def sight_points(part_id, excluded):
    """Points all over a part except the pieces that belong outside the case."""
    nodes = load_nodes(ensure_part(part_id))
    kept = merged(mesh for key, mesh in nodes.items() if key not in excluded)
    samples, _ = trimesh.sample.sample_surface(kept, 20000, seed=6)
    return thin_out(np.vstack([kept.vertices, samples]), 1.0)


def tilted(direction):
    across = np.eye(3)[np.argsort(np.abs(direction))[:2]]
    rays = [direction] + [direction + sign * TILT * axis for axis in across for sign in (1, -1)]
    return [ray / np.linalg.norm(ray) for ray in rays]


def points_seeing_out(points, walls):
    """Which points can see straight out of the case. A real opening lets slightly tilted sight lines out too, and a thin seam gap does not."""
    seen = np.zeros(len(points), dtype=bool)
    if not len(points):
        return seen
    for direction in OUTWARD:
        escapes = np.ones(len(points), dtype=bool)
        for ray in tilted(np.array(direction, dtype=float)):
            escapes &= ~walls.ray.intersects_any(points, np.tile(ray, (len(points), 1)))
        seen |= escapes
    return seen


class Grid:
    """A coarse map of the case, so open space can be followed from one place to another."""

    def __init__(self, bounds):
        self.origin = bounds[0] - 4 * PITCH + 0.37
        self.shape = np.ceil((bounds[1] - bounds[0]) / PITCH).astype(int) + 9

    def indices(self, points):
        found = np.floor((points - self.origin) / PITCH).astype(int)
        keep = np.all((found >= 0) & (found < self.shape), axis=1)
        return found[keep]

    def centers(self, indices):
        return self.origin + (indices + 0.5) * PITCH

    def mark_surface(self, solid, mesh):
        # The plastic is filled as well as its skin, so a chance gap in the skin cannot make a false route through a wall.
        self.mark_inside(solid, mesh)
        count = max(2000, int(mesh.area / 0.12))
        samples, _ = trimesh.sample.sample_surface(mesh, count, seed=7)
        found = self.indices(np.vstack([samples, mesh.vertices]))
        solid[found[:, 0], found[:, 1], found[:, 2]] = True

    def mark_points(self, solid, points):
        found = self.indices(points)
        solid[found[:, 0], found[:, 1], found[:, 2]] = True

    def mark_inside(self, solid, mesh):
        low = np.maximum(np.floor((mesh.bounds[0] - self.origin) / PITCH).astype(int), 0)
        high = np.minimum(np.ceil((mesh.bounds[1] - self.origin) / PITCH).astype(int) + 1, self.shape)
        if np.any(high <= low):
            return
        ranges = [np.arange(a, b) for a, b in zip(low, high)]
        cells = np.stack(np.meshgrid(*ranges, indexing="ij"), axis=-1).reshape(-1, 3)
        inside = mesh.contains(self.centers(cells))
        solid[cells[inside, 0], cells[inside, 1], cells[inside, 2]] = True


def outside_flood(grid, solid):
    labels, _ = ndimage.label(~solid)
    return labels == labels[0, 0, 0]


def leak_path(grid, solid, start):
    """The shortest open route from a place inside the case to the outside, to say where the opening is."""
    came_from = {tuple(start): None}
    queue = deque([tuple(start)])
    while queue:
        cell = queue.popleft()
        if min(cell) == 0 or any(c == s - 1 for c, s in zip(cell, grid.shape)):
            path = []
            while cell is not None:
                path.append(cell)
                cell = came_from[cell]
            return grid.centers(np.array(path[::-1]))
        for step in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
            near = (cell[0] + step[0], cell[1] + step[1], cell[2] + step[2])
            if near not in came_from and all(0 <= c < s for c, s in zip(near, grid.shape)) and not solid[near]:
                came_from[near] = cell
                queue.append(near)
    return None


def case_openness(union, corridors, seeds):
    """Fills every allowed opening, then floods in from outside. If the flood reaches the parts, the case has an opening nobody asked for. Returns the route if so."""
    bounds = np.array([np.minimum(union.bounds[0], seeds.min(axis=0)), np.maximum(union.bounds[1], seeds.max(axis=0))])
    grid = Grid(bounds)
    solid = np.zeros(grid.shape, dtype=bool)
    grid.mark_surface(solid, union)
    for mesh in corridors:
        grid.mark_inside(solid, mesh)
    outside = outside_flood(grid, solid)
    found = grid.indices(seeds)
    free = found[~solid[found[:, 0], found[:, 1], found[:, 2]]]
    reached = free[outside[free[:, 0], free[:, 1], free[:, 2]]]
    if not len(reached):
        return None
    return leak_path(grid, solid, reached[0])


def check_openings(design, cards, transforms, purchased, union):
    corridors = opening_corridors(design, cards, transforms)
    walls = merged([union] + [mesh for _, mesh in corridors])
    allowed = sorted({label for label, _ in corridors})
    limit = f"open only at: {', '.join(allowed)}. USB {PORT_NOTE}, button hole {BUTTON_HOLE_DIAMETER} mm (assumed)"
    results = []
    for name, card in cards.items():
        if name not in transforms:
            continue
        excluded = tuple(node for feature in OUTSIDE_FEATURES if feature in card["features"] for node in card["features"][feature].get("nodes", []))
        points = apply(transforms[name], sight_points(purchased[name]["part_id"], excluded))
        seen = points[points_seeing_out(points, walls)]
        place = rounded(seen.mean(axis=0)) if len(seen) else None
        results.append(result("opening_fit", name, len(seen) <= MAX_VISIBLE_POINTS, measured=len(seen), limit=f"{name} is hidden except through allowed openings: {limit}", where=place,
                              fix=f"{name} can be seen from outside near {place}, through an opening bigger than its purpose. Make every opening a closed hole fitted to its part. Close this one, or shrink it to its allowed size."))
    seeds = []
    for name, card in cards.items():
        if name in transforms and "pcb" in card["features"]:
            middle = (np.array(card["features"]["pcb"]["min"]) + np.array(card["features"]["pcb"]["max"])) / 2
            seeds.append(apply(transforms[name], middle[None])[0])
    if seeds:
        path = case_openness(union, [mesh for _, mesh in corridors], np.array(seeds))
        place = None
        if path is not None:
            inside = union.convex_hull.contains(path)
            place = rounded(path[inside][-1]) if inside.any() else rounded(path[0])
        results.append(result("case_closed", "case", path is None, measured=None if path is None else f"open route of {len(path)} mm from inside to outside", limit=f"no open route from the parts to outside, except through: {limit}", where=place,
                              fix=f"Air can get from the parts to the outside near {place}, through an opening that is not fitted to a part. Close it, or shrink it to its allowed size. A gap left at the seam counts too."))
    return results


PORT_NOTE = "plug room only"


def check_wire_room(design, cards, transforms, purchased, union):
    """Real jumpers are floppy, so what matters is a connected open space big enough to hold them, not one exact route."""
    if len(purchased) < 2:
        return []
    controllers = [n for n in purchased if cards[n].get("role") == "controller"]
    if len(controllers) != 1 or set(transforms) != set(purchased):
        return []
    ids = [purchased[controllers[0]]["part_id"]] + [purchased[n]["part_id"] for n in purchased if n != controllers[0]]
    wires = wires_for(ids)
    name_of = {purchased[n]["part_id"]: n for n in purchased}

    grid = Grid(union.bounds)
    solid = np.zeros(grid.shape, dtype=bool)
    grid.mark_surface(solid, union)
    for name in transforms:
        grid.mark_points(solid, apply(transforms[name], part_surface(purchased[name]["part_id"])[1]))
    ends = {}
    for wire in wires:
        pair = []
        for end in (wire["from"], wire["to"]):
            owner = name_of[end["part_id"]]
            plug = plug_local(end)
            grid.mark_inside(solid, plug_box(plug, transforms[owner]))
            pair.append(apply(transforms[owner], plug["back"][None])[0])
        ends[wire["net"]] = pair
    # One step in from every surface, so a space only counts if a small bundle fits through it.
    roomy = ndimage.binary_erosion(~solid, iterations=1)
    labels, _ = ndimage.label(roomy)
    cells = np.argwhere(roomy)
    if not len(cells):
        return [result("wire_room", "case", False, measured=0, limit="open space inside the case", fix="There is no open space for wires inside the case. Make room.")]
    tree = cKDTree(grid.centers(cells))
    outside_label = labels[0, 0, 0]
    hull = union.convex_hull
    declared = {w.get("net"): w.get("path") for w in design.get("wires") or [] if isinstance(w, dict)}
    results, needed, used = [], 0.0, set()
    for net, (first, second) in ends.items():
        distance, nearest = tree.query(np.array([first, second]))
        ids_near = [int(labels[tuple(cells[i])]) for i in nearest]
        connected = bool(distance.max() <= WIRE_SEED_REACH and ids_near[0] == ids_near[1])
        place = rounded(first if distance[0] >= distance[1] else second)
        results.append(result("wire_room", net, connected, measured=f"plug ends {round(float(distance[0]), 1)} and {round(float(distance[1]), 1)} mm from open space, {'connected' if connected else 'not connected'}", limit="one open space, at least about 3 mm wide, links both plug ends (assumed)", where=place,
                              fix=f"Wire {net} has no connected open space between its plugs. Open a channel at least 3 mm wide from {rounded(first)} to {rounded(second)}, past any walls, posts and ribs. The wire is floppy, so it needs room, not one exact path."))
        if connected:
            used.add(ids_near[0])
        try:
            length = float(np.linalg.norm(np.diff(np.array(declared[net], dtype=float), axis=0), axis=1).sum())
        except (KeyError, TypeError, ValueError):
            length = float(np.linalg.norm(first - second))
        needed += min((j for j in JUMPER_LENGTHS if j >= length), default=JUMPER_LENGTHS[-1]) * np.pi * WIRE_RADIUS ** 2 / BUNDLE_PACKING
    room = 0
    for label in used:
        region = grid.centers(np.argwhere(labels == label))
        room += int(hull.contains(region).sum()) if label == outside_label else len(region)
    room_volume = room * PITCH ** 3
    results.append(result("wire_bay", "case", room_volume >= needed, measured=f"{room_volume:.0f} mm3 open", limit=f"at least {needed:.0f} mm3 for the jumpers, using the shortest of {JUMPER_LENGTHS} mm that reaches, packed at {BUNDLE_PACKING} (assumed)", where=None,
                          fix=f"The wires need about {needed:.0f} mm3 of open space and there is {room_volume:.0f} mm3. Make the space behind the parts bigger, or shorten the routes so a shorter jumper reaches."))
    return results
