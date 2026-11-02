"""Tested pieces for the inside of a case. The AI designs the outside and decides where parts go; these pieces read real part sizes and build the rest.

The case goes together along world y: the screen faces -y, and the flat rear cover (Base) closes from +y. Every size comes from parts_data.json.
Each piece keeps its safe limits. A piece raises a clear error, rather than building something that cannot print or cannot be assembled.
"""
import json

from build123d import Box, Cylinder, Pos, Rot, export_stl

# Limits, in mm. A real print may change these numbers; nothing else needs to.
GAP = 0.15
MIN_WALL = 1.6
HOLDER_WALL = 2.4
MIN_STOP_WIDTH = 4.0
MAX_STOP_SLENDERNESS = 8.0
POST_RADIUS = 2.8
PLUG_WIDTH = 2.8
COVER_THICKNESS = 3.0
SEAM_GAP = 0.15
SCREW_CLEAR_RADIUS = 1.1
SCREW_PILOT_RADIUS = 0.75
SCREW_CLEAR_LENGTH = 5.0
SCREW_GRIP_LENGTH = 3.0
DRIVER_RADIUS = 2.6
HEAD_SEAT = 1.4
TOUCH_RADIUS = 5.0
FAR = 400.0
FITTED_LATER = ("knob", "shaft", "bushing")
AXES = {"+x": (1, 0, 0), "-x": (-1, 0, 0), "+y": (0, 1, 0), "-y": (0, -1, 0), "+z": (0, 0, 1), "-z": (0, 0, -1)}


def load_data(path="parts_data.json"):
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def one_solid(shape, name="part"):
    solids = shape.solids()
    assert len(solids) == 1, f"{name} has {len(solids)} solids, expected 1. Two pieces do not touch, or a cut split it."
    return solids[0]


def block(low, high):
    """A box between two opposite corners."""
    size = [max(high[i] - low[i], 0.01) for i in range(3)]
    return Pos(*[(low[i] + high[i]) / 2 for i in range(3)]) * Box(*size)


def along_y(x, z, y0, y1, radius):
    return Pos(x, (y0 + y1) / 2, z) * (Rot(X=90) * Cylinder(radius, abs(y1 - y0)))


def joined(shapes):
    result = shapes[0]
    for shape in shapes[1:]:
        result = result + shape
    return result


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


class Part:
    """A real part at its place in the case. Sizes cannot change, so only its position and turn are chosen."""

    def __init__(self, data, name, faces, up, local_up, at, anchor=None):
        self.name = name
        self.data = data["parts"][name]
        self.part_id = self.data["part_id"]
        front = AXES[self.data["front"]]
        local_up_vector = AXES[local_up]
        assert abs(sum(a * b for a, b in zip(front, local_up_vector))) < 1e-9, f"{name}: local_up {local_up} must be square to its front {self.data['front']}"
        world_front, world_up = AXES[faces], AXES[up]
        assert abs(sum(a * b for a, b in zip(world_front, world_up))) < 1e-9, f"{name}: up {up} must be square to faces {faces}"
        local_third, world_third = _cross(front, local_up_vector), _cross(world_front, world_up)
        rotation = [[front[j] * world_front[i] + local_up_vector[j] * world_up[i] + local_third[j] * world_third[i] for j in range(3)] for i in range(3)]
        self.rotation = rotation
        self.matrix = [rotation[i] + [0.0] for i in range(3)] + [[0, 0, 0, 1]]
        origin = [0.0, 0.0, 0.0]
        if anchor:
            feature = self.data["features"][anchor]
            origin = self.point([(feature["min"][i] + feature["max"][i]) / 2 for i in range(3)])
        for i in range(3):
            self.matrix[i][3] = at[i] - origin[i]

    def point(self, local):
        matrix = getattr(self, "matrix", None)
        rotated = [sum(self.rotation[i][j] * local[j] for j in range(3)) for i in range(3)]
        return [rotated[i] + (matrix[i][3] if matrix else 0.0) for i in range(3)]

    def direction(self, local):
        return [sum(self.rotation[i][j] * local[j] for j in range(3)) for i in range(3)]

    def world_box(self, low, high):
        corners = [self.point([x, y, z]) for x in (low[0], high[0]) for y in (low[1], high[1]) for z in (low[2], high[2])]
        return [min(c[i] for c in corners) for i in range(3)], [max(c[i] for c in corners) for i in range(3)]

    def feature(self, name):
        found = self.data["features"][name]
        return self.world_box(found["min"], found["max"])

    def solids(self, include_later=False):
        """Every solid on the part as world boxes, leaving out what is fitted after the case closes."""
        skip = [] if include_later else [self.feature(n) for n in FITTED_LATER if n in self.data["features"]]
        boxes = []
        for low, high in self.data["solids"]:
            world = self.world_box(low, high)
            if not any(all(s[0][i] - 0.01 <= world[0][i] and world[1][i] <= s[1][i] + 0.01 for i in range(3)) for s in skip):
                boxes.append(world)
        return boxes

    def plugs(self, data):
        """The boxes the jumper plugs on this part need, including the wire's first straight run."""
        boxes = []
        for wire in data["wires"]:
            for end in (wire["from"], wire["to"]):
                if end["name"] == self.name:
                    start, back = self.point(end["start"]), self.point(end["back"])
                    low = [min(start[i], back[i]) - PLUG_WIDTH / 2 for i in range(3)]
                    high = [max(start[i], back[i]) + PLUG_WIDTH / 2 for i in range(3)]
                    boxes.append((low, high))
        return boxes


def front_surface(body, x, z, half=0.5):
    """Where the outside of the body's front is at this spot. Bodies are curved and stepped, so the bounding box is not enough."""
    column = body & block([x - half, -FAR, z - half], [x + half, FAR, z + half])
    assert column.solids(), f"The body does not reach x={x}, z={z}."
    return column.bounding_box().min.Y


def deepest_front(body, x0, x1, z0, z1, samples=4):
    """The deepest front surface over an area. A part placed behind this keeps its whole face behind the wall."""
    points = [(x0 + (x1 - x0) * i / (samples - 1), z0 + (z1 - z0) * j / (samples - 1)) for i in range(samples) for j in range(samples)]
    return max(front_surface(body, x, z) for x, z in points)


def split(body, seam_y):
    """The Shell blank in front of the seam and the flat cover behind it, with the gap between them."""
    shell = one_solid(body - block([-FAR, seam_y, -FAR], [FAR, FAR, FAR]), "shell blank")
    cover = one_solid(body - block([-FAR, -FAR, -FAR], [FAR, seam_y + SEAM_GAP, FAR]), "cover blank")
    return shell, cover


def pocket(part, to_y, data=None, gap=GAP, levels=6):
    """The room a part needs in the Shell. It widens only toward the back, so the part always has a straight path in from the back."""
    boxes = part.solids() + (part.plugs(data) if data else [])
    fronts = sorted(b[0][1] for b in boxes)
    steps = []
    for front in fronts:
        if not steps or front - steps[-1] >= 0.3:
            steps.append(front)
    steps = steps[:levels]
    cuts = []
    for index, step in enumerate(steps):
        # The last step takes everything left, so nothing is missed when steps are capped.
        inside = boxes if index == len(steps) - 1 else [b for b in boxes if b[0][1] <= step + 0.299]
        low = [min(b[0][i] for b in inside) - gap for i in range(3)]
        high = [max(b[1][i] for b in inside) + gap for i in range(3)]
        low[1], high[1] = step - gap, to_y
        cuts.append(block(low, high))
    return joined(cuts)


def outline(part, gap=GAP):
    """The part's outline seen along y: (x low, x high, z low, z high). Nothing on the Shell may enter it behind the part."""
    boxes = part.solids()
    return (min(b[0][0] for b in boxes) - gap, max(b[1][0] for b in boxes) + gap, min(b[0][2] for b in boxes) - gap, max(b[1][2] for b in boxes) + gap)


def window(part, gap=0.2):
    """A closed hole around the glass, straight out through the front."""
    low, high = part.feature("glass")
    return block([low[0] - gap, -FAR, low[2] - gap], [high[0] + gap, high[1], high[2] + gap])


def usb_opening(part, data):
    """The room for the USB plug, straight out from the socket mouth, as the plug-room check measures it."""
    usb = part.data["features"]["usb"]
    room = data["plug_room"][usb["connector"]]
    axis = "xyz".index(usb["opens_toward"][1])
    sign = 1 if usb["opens_toward"][0] == "+" else -1
    others = [i for i in range(3) if i != axis]
    sizes = {i: usb["max"][i] - usb["min"][i] for i in others}
    wide, tall = sorted(others, key=lambda i: -sizes[i])
    centre = [(usb["min"][i] + usb["max"][i]) / 2 for i in range(3)]
    low, high = list(centre), list(centre)
    low[axis], high[axis] = sorted((usb["mouth"] - sign * 0.2, usb["mouth"] + sign * room["length"]))
    low[wide], high[wide] = centre[wide] - room["width"] / 2, centre[wide] + room["width"] / 2
    low[tall], high[tall] = centre[tall] - room["height"] / 2, centre[tall] + room["height"] / 2
    return block(*part.world_box(low, high))


def shaft_hole(part, gap=GAP):
    """A closed round hole for a knob's bushing, straight out through the front, with a wall all round it."""
    low, high = part.feature("bushing")
    x, z = (low[0] + high[0]) / 2, (low[2] + high[2]) / 2
    radius = max(high[0] - low[0], high[2] - low[2]) / 2 + gap
    return along_y(x, z, -FAR, high[1], radius)


def knob_recess(part, depth_from_y, room=5.0):
    """Finger room around the knob, cut into the front from outside down to depth_from_y."""
    low, high = part.feature("knob")
    x, z = (low[0] + high[0]) / 2, (low[2] + high[2]) / 2
    radius = max(high[0] - low[0], high[2] - low[2]) / 2 + room + 0.2
    return along_y(x, z, -FAR, depth_from_y, radius)


def touch_opening(part, depth=2.0):
    """A round finger opening over the middle of a touch sensor, with a shallow dimple in the wall around it."""
    low, high = part.feature("touch")
    pcb_low, pcb_high = part.feature("pcb")
    x, z = (low[0] + high[0]) / 2, (low[2] + high[2]) / 2
    assert x - TOUCH_RADIUS > pcb_low[0] and x + TOUCH_RADIUS < pcb_high[0] and z - TOUCH_RADIUS > pcb_low[2] and z + TOUCH_RADIUS < pcb_high[2], "The touch opening must stay inside the sensor's outline."
    return along_y(x, z, -FAR, pcb_low[1], TOUCH_RADIUS)


def stop(part, x, z, cover_y, width=MIN_STOP_WIDTH, clear_of=()):
    """A sturdy column from the rear cover to just behind a part. It thickens by itself when it is long, and steps wider at the root, so it prints and does not snap. clear_of lists parts it must not run through."""
    half = width / 2
    behind = [b[1][1] for b in part.solids() if b[0][0] <= x + half + GAP and b[1][0] >= x - half - GAP and b[0][2] <= z + half + GAP and b[1][2] >= z - half - GAP]
    assert behind, f"No part of {part.name} lies behind {(x, z)}, so a stop there holds nothing."
    tip = max(behind) + GAP
    length = cover_y - tip
    assert length > 0, f"The stop for {part.name} at {(x, z)} would have negative length. Move the cover back."
    width = max(width, length / MAX_STOP_SLENDERNESS)
    half = width / 2
    behind = [b[1][1] for b in part.solids() if b[0][0] <= x + half + GAP and b[1][0] >= x - half - GAP and b[0][2] <= z + half + GAP and b[1][2] >= z - half - GAP]
    tip = max(behind) + GAP
    column = block([x - half, tip, z - half], [x + half, cover_y + 0.5, z + half])
    for other in clear_of:
        x0, x1, z0, z1 = outline(other)
        reach = half * 1.6
        if x0 - reach < x < x1 + reach and z0 - reach < z < z1 + reach:
            raise AssertionError(f"A stop at x={x}, z={z} would run through {other.name}. Its outline is x {x0:.1f} to {x1:.1f}, z {z0:.1f} to {z1:.1f}, and the stop needs {reach:.1f} mm beyond that.")
    root_start = tip + (cover_y - tip) * 0.6
    # The whole stop stays inside the part's outline, so it never touches the Shell around that part.
    x0, x1, z0, z1 = outline(part)
    assert x0 + GAP <= x - half and x + half <= x1 - GAP and z0 + GAP <= z - half and z + half <= z1 - GAP, f"A stop at x={x}, z={z} sticks out past {part.name}'s outline, x {x0:.1f} to {x1:.1f}, z {z0:.1f} to {z1:.1f}. Move it in by {half:.1f} mm."
    root_low = [max(x - half * 1.6, x0 + GAP), root_start, max(z - half * 1.6, z0 + GAP)]
    root_high = [min(x + half * 1.6, x1 - GAP), cover_y + 0.5, min(z + half * 1.6, z1 - GAP)]
    return column + block(root_low, root_high)


def tower(part, cover_y, wall=HOLDER_WALL, data=None):
    """A sturdy holder built into the rear cover. Walls rise from the cover and locate a board by its edges, with a ledge behind it. The board drops in from the front."""
    pcb_low, pcb_high = part.feature("pcb")
    near = pcb_high[1]
    occupied = [b for b in part.solids() if b[1][1] > near + 0.01]
    behind = max([b[1][1] for b in occupied] + [near]) + GAP
    assert cover_y >= behind, f"{part.name} needs the cover at y >= {behind:.2f} for what stands behind its board."
    inner_low = [pcb_low[0] - GAP, pcb_low[2] - GAP]
    inner_high = [pcb_high[0] + GAP, pcb_high[2] + GAP]
    front = pcb_low[1] - 1.0
    outer = block([inner_low[0] - wall, front, inner_low[1] - wall], [inner_high[0] + wall, cover_y + 0.5, inner_high[1] + wall])
    hole = block([inner_low[0], front - 1, inner_low[1]], [inner_high[0], near + GAP, inner_high[1]])
    room_behind = block([inner_low[0] + 1.5, near + GAP - 0.1, inner_low[1] + 1.5], [inner_high[0] - 1.5, behind, inner_high[1] - 1.5])
    shape = outer - hole - room_behind
    # Everything that stands behind the board or passes its edge gets a straight clear path out the front, wherever it starts on the board.
    clearances = []
    room_x0, room_z0, room_x1, room_z1 = inner_low[0] + 1.5, inner_low[1] + 1.5, inner_high[0] - 1.5, inner_high[1] - 1.5
    for low, high in part.solids():
        passes_edge = low[0] < inner_low[0] or high[0] > inner_high[0] or low[2] < inner_low[1] or high[2] > inner_high[1]
        behind_board = high[1] > near + 0.001
        outside_room = low[0] < room_x0 or high[0] > room_x1 or low[2] < room_z0 or high[2] > room_z1
        if high[1] >= front and (passes_edge or (behind_board and outside_room)):
            clearances.append(block([low[0] - GAP, front - 1, low[2] - GAP], [high[0] + GAP, high[1] + GAP, high[2] + GAP]))
    if clearances:
        shape = shape - joined(_merged_boxes(clearances, part, front, gap=GAP))
    return shape


def _merged_boxes(clearances, part, front, gap):
    """The same clearances, kept to a small number of cuts so the holder stays fast to build."""
    return clearances[:60] if len(clearances) <= 60 else _grouped(part, front, gap)


def _grouped(part, front, gap, cell=2.0):
    """Many small solids, such as rows of pins, are joined into one cut per occupied patch."""
    patches = {}
    for low, high in part.solids():
        if high[1] < front:
            continue
        key = (round(low[0] / cell), round(low[2] / cell))
        current = patches.get(key)
        patches[key] = [[min(low[i], current[0][i]) for i in range(3)], [max(high[i], current[1][i]) for i in range(3)]] if current else [list(low), list(high)]
    return [block([low[0] - gap, front - 1, low[2] - gap], [high[0] + gap, high[1] + gap, high[2] + gap]) for low, high in patches.values()]


def free_spots(parts, x0, x1, z0, z1, reach=POST_RADIUS, towers=(), step=2.0, body=None, y=None):
    """Places a post or stop can go without blocking any part: every (x, z) in the area that is clear of each part's outline by reach. With the body and a y given, only places where it fits inside the body. Ask this first, rather than guessing."""
    outlines = [outline(p) for p in parts] + [outline(p, GAP + HOLDER_WALL) for p in towers]
    spots = []
    count_x, count_z = int((x1 - x0) / step), int((z1 - z0) / step)
    for i in range(count_x + 1):
        for j in range(count_z + 1):
            x, z = x0 + i * step, z0 + j * step
            if not any(a - reach < x < b + reach and c - reach < z < d + reach for a, b, c, d in outlines):
                if body is None or all(inside(body, px, y - depth, pz) for px, pz in ((x - reach - 0.4, z), (x + reach + 0.4, z), (x, z - reach - 0.4), (x, z + reach + 0.4)) for depth in (0.3, 9.0)):
                    spots.append((round(x, 2), round(z, 2)))
    return spots


def stop_spots(part, clear_of=(), width=MIN_STOP_WIDTH, step=2.0):
    """Places a stop can go behind a part: inside its outline, and clear of the other parts it must not run through."""
    x0, x1, z0, z1 = outline(part)
    half = width / 2 + GAP
    reach = width / 2 * 1.6
    outlines = [outline(p) for p in clear_of]
    spots = []
    x = x0 + half
    while x <= x1 - half:
        z = z0 + half
        while z <= z1 - half:
            if not any(a - reach < x < b + reach and c - reach < z < d + reach for a, b, c, d in outlines):
                spots.append((round(x, 2), round(z, 2)))
            z += step
        x += step
    return spots


def inside(body, x, y, z):
    """True if this point is inside the body."""
    from build123d import Vector
    return body.is_inside(Vector(x, y, z))


def outside_points(body, low, high, wall=MIN_WALL, levels=3):
    """Points around a box, grown by a wall, that are not inside the body. Empty means the box keeps at least that wall all round."""
    xs, zs = (low[0] - wall, high[0] + wall), (low[2] - wall, high[2] + wall)
    ys = [low[1] + (high[1] - low[1]) * i / (levels - 1) for i in range(levels)]
    points = [(x, y, z) for x in xs for z in zs for y in ys]
    points += [((low[0] + high[0]) / 2, y, z) for z in zs for y in ys] + [(x, y, (low[2] + high[2]) / 2) for x in xs for y in ys]
    return [p for p in points if not inside(body, *p)]


def tower_room(part, to_y, wall=HOLDER_WALL, gap=GAP, body=None):
    """The room the holder needs in the Shell, so the Shell closes over it. Whether the holder then shows on the outside is measured on the real files by the outside check. body is accepted for older scripts and not used."""
    pcb_low, pcb_high = part.feature("pcb")
    low = [pcb_low[0] - GAP - wall - gap, pcb_low[1] - 1.0 - gap, pcb_low[2] - GAP - wall - gap]
    high = [pcb_high[0] + GAP + wall + gap, to_y, pcb_high[2] + GAP + wall + gap]
    return block(low, high)


SNAP_ARM_LENGTH = 10.0
SNAP_ARM_THICKNESS = 1.6
SNAP_WIDTH = 8.0
SNAP_HOOK_DEPTH = 0.8
SNAP_HOOK_LENGTH = 2.0
MAX_SNAP_STRAIN = 0.02


def side_surface(body, side, y, z, half=0.5):
    """Where the outside of the body is on one side (-x or +x) at this height and depth."""
    column = body & block([-FAR, y - half, z - half], [FAR, y + half, z + half])
    assert column.solids(), f"The body does not reach y={y}, z={z}."
    box = column.bounding_box()
    return box.min.X if side == "-x" else box.max.X


class Snap:
    """A one-arm snap latch: an arm on the rear cover, with a hook at its tip that clicks into a pocket inside the Shell's side wall. Use it where a side has no room for a screw post. It needs no flexing room outside the case, and it refuses a place where the wall around it would be too thin.

    The arm stands up from the cover plate, so its layers run across it when the cover prints flat. That is the weak direction, so the arm is kept short and thick, and PETG holds it better than PLA."""

    def __init__(self, body, side, z, seam_y, length=SNAP_ARM_LENGTH, thickness=SNAP_ARM_THICKNESS, width=SNAP_WIDTH, depth=SNAP_HOOK_DEPTH):
        assert side in ("-x", "+x"), "A snap goes on the -x or +x side."
        strain = 1.5 * thickness * depth / length ** 2
        assert strain <= MAX_SNAP_STRAIN, f"This arm would bend {strain:.1%}, more than the {MAX_SNAP_STRAIN:.0%} printed plastic takes. Make it longer or the hook shallower."
        self.side, self.z, self.seam_y = side, z, seam_y
        self.length, self.thickness, self.width, self.depth = length, thickness, width, depth
        outward = -1 if side == "-x" else 1
        tip_y = seam_y - length
        surfaces = [side_surface(body, side, y, zz) for y in (tip_y, tip_y + SNAP_HOOK_LENGTH, seam_y - 0.5) for zz in (z - width / 2, z + width / 2)]
        outside = max(surfaces) if side == "-x" else min(surfaces)
        # The pocket's outer face keeps a full wall to the outside of the body.
        pocket_outer = outside - outward * MIN_WALL
        hook_outer = pocket_outer - outward * GAP
        self.arm_outer = hook_outer - outward * depth
        arm_inner = self.arm_outer - outward * thickness
        self.outward = outward
        self.tip_y = tip_y

        def span(a, b):
            return min(a, b), max(a, b)

        self.arm_x = span(self.arm_outer, arm_inner)
        self.hook_x = span(hook_outer, self.arm_outer)
        self.slot_x = span(self.arm_outer + outward * GAP, arm_inner - outward * (depth + GAP))
        assert abs(self.arm_x[0]) < FAR and inside(body, (self.slot_x[0] + self.slot_x[1]) / 2, tip_y, z), f"A snap on the {side} side at z={z} is not inside the body."

    def arm(self):
        """Add to the cover: the arm and its hook. The hook's front is sloped so it rides up the slot, and its back is square so it holds."""
        from build123d import Rot
        z0, z1 = self.z - self.width / 2, self.z + self.width / 2
        arm = block([self.arm_x[0], self.tip_y, z0], [self.arm_x[1], self.seam_y + SEAM_GAP + 0.5, z1])
        hook = block([self.hook_x[0], self.tip_y, z0], [self.hook_x[1], self.tip_y + SNAP_HOOK_LENGTH, z1])
        edge_x = self.hook_x[0] if self.outward < 0 else self.hook_x[1]
        ramp = Pos(edge_x, self.tip_y, self.z) * (Rot(Z=45) * Box(self.depth * 1.42, self.depth * 1.42, self.width + 2))
        return arm + (hook - ramp)

    def shell_cut(self):
        """Cut from the Shell: a slot the arm slides into, with room for it to bend inward, and the pocket the hook clicks into."""
        z0, z1 = self.z - self.width / 2 - GAP, self.z + self.width / 2 + GAP
        slot = block([self.slot_x[0], self.tip_y - GAP, z0], [self.slot_x[1], self.seam_y + 1, z1])
        pocket = block([min(self.hook_x) - GAP if self.outward < 0 else self.arm_outer, self.tip_y - GAP, z0], [self.arm_outer if self.outward < 0 else max(self.hook_x) + GAP, self.tip_y + SNAP_HOOK_LENGTH + GAP, z1])
        return slot + pocket

    def entry(self):
        z0, z1 = self.z - self.width / 2, self.z + self.width / 2
        return {"kind": "snap", "side": self.side, "on": "PRINT_Base", "into": "PRINT_Shell", "at": [(self.hook_x[0] + self.hook_x[1]) / 2, self.tip_y + SNAP_HOOK_LENGTH / 2, self.z],
                "hook": [[self.hook_x[0], self.tip_y, z0], [self.hook_x[1], self.tip_y + SNAP_HOOK_LENGTH, z1]], "flex": [[min(self.slot_x[0], self.slot_x[1]), self.tip_y, z0], [max(self.slot_x[0], self.slot_x[1]), self.seam_y, z1]],
                "arm_length": self.length, "arm_thickness": self.thickness, "hook_depth": self.depth}


class Screw:
    """One screw from the back of the cover into a post on the Shell. Refuses a post that would block a part's path in."""

    def __init__(self, x, z, back_y, seam_y, parts=(), towers=(), body=None):
        if body is not None:
            front = seam_y + SEAM_GAP + HEAD_SEAT - SCREW_CLEAR_LENGTH - SCREW_GRIP_LENGTH - 0.5
            reach = POST_RADIUS + 0.4
            missing = [p for p in ((x - reach, z), (x + reach, z), (x, z - reach), (x, z + reach), (x, z)) for y in (front, seam_y - 0.3) if not inside(body, p[0], y, p[1])]
            assert not missing, f"A screw post at x={x}, z={z} would stick out of the body. Use free_spots(..., body=body, y=seam_y) for places inside it."
        for part in list(parts) + list(towers):
            x0, x1, z0, z1 = outline(part, GAP + (HOLDER_WALL if part in towers else 0))
            if x0 - POST_RADIUS < x < x1 + POST_RADIUS and z0 - POST_RADIUS < z < z1 + POST_RADIUS:
                raise AssertionError(f"A screw post at x={x}, z={z} would block {part.name} on its way in. Its outline is x {x0:.1f} to {x1:.1f}, z {z0:.1f} to {z1:.1f}, and the post needs {POST_RADIUS} mm beyond that.")
        self.x, self.z = x, z
        self.head_y = seam_y + SEAM_GAP + HEAD_SEAT
        assert self.head_y < back_y, "The cover is too thin for a screw head."
        self.back_y = back_y
        self.post_front = self.head_y - SCREW_CLEAR_LENGTH - SCREW_GRIP_LENGTH - 0.5
        self.seam_y = seam_y

    def post(self):
        """Add to the Shell, then cut pilot_and_clear from it."""
        return along_y(self.x, self.z, self.post_front, self.seam_y, POST_RADIUS)

    def shell_cut(self):
        return along_y(self.x, self.z, self.head_y - SCREW_CLEAR_LENGTH, self.seam_y + 1, SCREW_CLEAR_RADIUS) + along_y(self.x, self.z, self.head_y - SCREW_CLEAR_LENGTH - SCREW_GRIP_LENGTH, self.head_y - SCREW_CLEAR_LENGTH + 0.01, SCREW_PILOT_RADIUS)

    def cover_cut(self):
        return along_y(self.x, self.z, self.seam_y - 1, self.head_y, SCREW_CLEAR_RADIUS) + along_y(self.x, self.z, self.head_y, self.back_y + 60, DRIVER_RADIUS)

    def entry(self):
        return {"head_at": [self.x, self.head_y, self.z], "drive_from": "+y", "through": "PRINT_Base", "into": "PRINT_Shell"}


def wire_paths(data, parts, lane_y, lane_step=0.6):
    """Guide paths for every wire: straight out of each plug, then side by side along lanes at y = lane_y. Real jumpers are floppy, so these only show the route."""
    by_name = {p.name: p for p in parts}
    paths = []
    for index, wire in enumerate(data["wires"]):
        a_part, b_part = by_name[wire["from"]["name"]], by_name[wire["to"]["name"]]
        a, b = a_part.point(wire["from"]["back"]), b_part.point(wire["to"]["back"])
        y = lane_y + index * lane_step
        paths.append({"net": wire["net"], "path": [a, [a[0], y, a[2]], [b[0], y, a[2]], [b[0], y, b[2]], b]})
    return paths


def finish(shell, base, screen_and_inputs, controller, screws, wires, glued=(), holder="PRINT_Base", insert_from="-y", snaps=()):
    """Checks each printed part is one solid, exports it, and writes design.json with the build order. The cover and controller go first, and the Shell closes over everything last."""
    prints = {"PRINT_Shell": one_solid(shell, "PRINT_Shell"), "PRINT_Base": one_solid(base, "PRINT_Base")}
    for name, shape in prints.items():
        assert shape.is_valid, f"{name} is not a valid solid."
        export_stl(shape, f"{name}.stl", tolerance=0.01)
    parts = [controller] + list(screen_and_inputs)
    design = {
        "print": {name: f"{name}.stl" for name in prints},
        "purchased": {p.name: {"part_id": p.part_id, "transform": p.matrix} for p in parts},
        "holds": {holder: {"part": controller.name, "insert_from": insert_from}},
        "case": {
            "assembly": [{"add": "PRINT_Base"}, {"add": controller.name, "from": "-y"}] + [{"add": p.name, "from": "-y"} for p in screen_and_inputs] + [{"add": "PRINT_Shell", "from": "-y"}],
            "screws": [s.entry() for s in screws],
            "glued": list(glued),
            "snaps": [snap.entry() for snap in snaps],
        },
        "wires": wires,
    }
    with open("design.json", "w", encoding="utf-8") as file:
        json.dump(design, file, indent=1)
    return design
