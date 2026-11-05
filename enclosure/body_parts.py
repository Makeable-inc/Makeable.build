"""Tested building blocks for character bodies: simple closed solids that always build, and joins that check
themselves. A body script imports these instead of writing risky surfacing code.

Units are mm, world +z up, the front faces -y, the body stands on z = 0. Every function returns one valid solid
or raises a clear error; `try_join` never raises, so one awkward feature never sinks the whole body.
"""
import math

from build123d import (Axis, Box, Cone, Cylinder, Ellipse, Kind, Circle, Plane, Polygon, Pos, Rectangle, RectangleRounded, Rot, Sphere, extrude,
                       fillet, loft,
                       offset, scale, Solid, Spline, Vector, Vertex, Wire, Face)

BIG = 2000.0
CORE = {}     # the main form's size before the first feature joins (mm), for the width / height rule
JOINED = {}   # name -> how much of each joined feature stands outside the body (mm3) and its size (mm)


def one_solid(shape, name="part"):
    solids = shape.solids()
    assert len(solids) == 1, f"{name} has {len(solids)} solids, expected 1"
    solid = solids[0]
    assert solid.is_valid, f"{name} is not a valid solid"
    return solid


def step_safe(solid):
    """The same solid with its closed faces (spheres, ellipsoids, rings) split in two. A closed face whose seam
    crosses a join can come back from a STEP file trimmed on the wrong side, so a joined arm or ear silently
    vanishes from BODY.step while BODY.stl still shows it; split faces survive the round trip."""
    from OCP.ShapeUpgrade import ShapeUpgrade_ShapeDivideClosed
    try:
        divide = ShapeUpgrade_ShapeDivideClosed(solid.wrapped)
        divide.SetNbSplitPoints(2)
        divide.Perform()
        out = Solid(divide.Result())
        return out if abs(out.volume - solid.volume) < 0.01 * solid.volume + 0.5 else solid
    except Exception:
        return solid


def fuse(a, b, name="part"):
    """a + b as one valid solid, checked: OpenCascade can silently drop most of a shape when two surfaces line up
    exactly, so the result must keep at least the larger of the two volumes. Closed faces are split first so the
    result survives export to STEP."""
    out = one_solid(step_safe(a) + step_safe(b), name)
    assert out.volume >= max(a.volume, b.volume) - 0.5, f"{name}: the join lost volume ({out.volume:.0f} mm3 left of {max(a.volume, b.volume):.0f})"
    return out


def placed(solid, at=(0, 0, 0), tilt=(0, 0, 0)):
    """Turn (degrees about x, then y, then z) and then move."""
    return one_solid(Pos(*at) * (Rot(*tilt) * solid), "placed")


# ---------- primitives: always valid closed solids ----------

def ellipsoid(rx, ry, rz, at=(0, 0, 0), tilt=(0, 0, 0)):
    """A stretched sphere: heads, cheeks, paws, bellies, eyes, noses."""
    assert min(rx, ry, rz) > 0, "ellipsoid radii must be positive"
    return placed(scale(Sphere(1), by=(rx, ry, rz)), at, tilt)


def capsule(radius, length, at=(0, 0, 0), tilt=(0, 0, 0)):
    """A rod with round ends, along z before turning: arms, legs, tails, handles, antenna stalks."""
    assert radius > 0 and length >= 0, "capsule needs a positive radius"
    rod = fuse(Cylinder(radius, length), Pos(0, 0, length / 2) * Sphere(radius), "capsule")
    rod = fuse(rod, Pos(0, 0, -length / 2) * Sphere(radius), "capsule")
    return placed(rod, at, tilt)


def cone_tip(base_radius, height, tip_radius=None, at=(0, 0, 0), tilt=(0, 0, 0)):
    """A cone with a rounded tip, base at z = 0 before turning: horns, spikes, beaks, pointed noses."""
    tip = tip_radius if tip_radius is not None else max(0.8, base_radius * 0.18)
    assert base_radius > tip > 0 and height > 2 * tip, "cone_tip: base must be wider than the tip and taller than it"
    body = fuse(Pos(0, 0, height / 2) * Cone(base_radius, tip, height), Pos(0, 0, height - 0.2 * tip) * Sphere(tip * 1.05), "cone_tip")
    return placed(body, at, tilt)


def oval_loft(sections, dome=0.0):
    """A soft main form through horizontal ovals [(z, rx, ry), ...], bottom to top, centred on x = y = 0.
    Use 3 to 6 sections. Keep neighbouring ovals within about 1.6x of each other so the loft never folds.
    dome: height (mm) of a rounded cap on the top oval; 0 leaves the top flat. For a smooth join make the top two
    ovals the same size, so the sides are upright where the dome begins (otherwise a ridge shows at the join)."""
    assert len(sections) >= 2, "oval_loft needs at least 2 sections"
    zs = [s[0] for s in sections]
    assert zs == sorted(zs) and len(set(zs)) == len(zs), "oval_loft sections must go strictly upward in z"
    faces = [Plane.XY.offset(z) * Ellipse(rx, ry) for z, rx, ry in sections]
    body = one_solid(loft(faces), "oval_loft")
    if dome > 0:
        z, rx, ry = sections[-1]
        cap = Pos(0, 0, z) * scale(Sphere(1), by=(rx, ry, dome))
        body = fuse(body, cap, "oval_loft dome")
    return body


def rounded_loft(sections, dome=0.0):
    """A soft but roomy main form through horizontal rounded rectangles [(z, width, depth, corner_radius), ...],
    bottom to top, centred on x = y = 0. Square-ish corners keep room inside for the parts, unlike ovals, which narrow
    toward their corners. dome: height of an oval cap on top; it leaves a visible ledge along the straight sides, so
    for a soft top use soft_box (or end the sections with a quarter-round inset) instead."""
    assert len(sections) >= 2, "rounded_loft needs at least 2 sections"
    zs = [s[0] for s in sections]
    assert zs == sorted(zs) and len(set(zs)) == len(zs), "rounded_loft sections must go strictly upward in z"
    for z, w, d, r in sections:
        assert 0 < r < min(w, d) / 2, f"corner radius {r} must be under half of {min(w, d)}"
    faces = [Plane.XY.offset(z) * RectangleRounded(w, d, r) for z, w, d, r in sections]
    body = one_solid(loft(faces), "rounded_loft")
    if dome > 0:
        z, w, d, r = sections[-1]
        cap = Pos(0, 0, z) * scale(Sphere(1), by=(w / 2 * 0.98, d / 2 * 0.98, dome))
        body = fuse(body, cap, "rounded_loft dome")
    return body


def soft_box(width, depth, height, radius, corner=None, bottom=2.0, flat_back=True, at=(0, 0, 0)):
    """A soft, cushion-like main form: a box rounded on every outside edge by `radius`, so it looks soft from the
    front and the side, not only from above. Centred on x = y = 0, flat sole at z = 0, exactly width x depth x height.
    radius: the roll on the top and side edges (12-20% of the height reads as soft). corner: radius seen from above,
    at least `radius` (default `radius`). bottom: how high the soft roll at the sole edge rises (the sole stays flat).
    flat_back: the back (+y) stays one flat face out to its edges, so the rear cover cut from it prints flat (keep it).
    Every rounded edge cuts into the room inside: size radius with max_round() from the spare room."""
    corner = radius if corner is None else max(corner, radius)
    assert 2 * radius < min(width, depth) and radius + bottom < height, "radius too big for this box"
    w, d = width - 2 * radius, depth - 2 * radius
    inner = corner - radius
    outline = RectangleRounded(w, d, inner) if inner > 0.3 else Rectangle(w, d)
    if flat_back:
        # The core reaches the back face, so only the front, top, sides and sole roll; the back is cut flat after.
        d = depth - radius
        outline = RectangleRounded(w, d, inner) if inner > 0.3 else Rectangle(w, d)
        outline = Pos(0, radius / 2) * outline
    core = Pos(0, 0, bottom) * extrude(outline, amount=height - radius - bottom)
    soft = offset(core, amount=radius, kind=Kind.ARC)
    soft = soft & Pos(0, 0, height / 2) * Box(width + 10, depth, height)
    return placed(one_solid(soft, "soft_box"), at)


def _superellipse(a, b, n, plane, count=48):
    """A closed superellipse |u/a|^n + |v/b|^n = 1 on a plane: n=2 an ellipse, n=4 a soft rounded box."""
    pts = []
    for i in range(count):
        t = 2 * math.pi * i / count
        c, s = math.cos(t), math.sin(t)
        u = a * math.copysign(abs(c) ** (2 / n), c)
        v = b * math.copysign(abs(s) ** (2 / n), s)
        pts.append(plane.from_local_coords((u, v)))
    try:
        return Wire([Spline(*pts, periodic=True)])
    except Exception:
        return Wire.make_polygon(pts, close=True)


MIN_BAND = 2.0     # mm: a rounded top band lower than this is built as straight sides (there is no room to round)


def note(block, text):
    """Tell the agent, in the build output, that a block built something other than asked, and why."""
    print(f"{block} note: {text}")


def _blob_band(a, b, n, top, start, reach, count, smooth, polygon):
    """The rounded top band of a superblob, from z = start to z = reach (raises if this way of lofting fails)."""
    outline = _polygon_superellipse if polygon else _superellipse
    faces = []
    for i in range(count):
        # slices closer together near the top, where the outline turns fastest, so the smooth loft does not swing
        f = math.sin(i / count * math.pi / 2)
        shrink = (1 - f ** top) ** (1 / top)
        faces.append(Face(outline(a * shrink, b * shrink, n, Plane.XY.offset(start + (reach - start) * f))))
    if top >= 3.5:
        # a flat top closes with a small flat cap: closing it in a point leaves a dent and a spike
        last = (1 - math.sin((count - 1) / count * math.pi / 2) ** top) ** (1 / top) * 0.6
        faces.append(Face(outline(a * last, b * last, n, Plane.XY.offset(reach))))
    else:
        faces.append(Vertex(0, 0, reach))   # a dome closes in a point, so it has no flat nub
    return one_solid(loft(faces, ruled=not smooth), "superblob")


def _polygon_superellipse(a, b, n, plane, count=64):
    pts = []
    for i in range(count):
        t = 2 * math.pi * i / count
        c, s = math.cos(t), math.sin(t)
        pts.append(plane.from_local_coords((a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s))))
    return Wire.make_polygon(pts, close=True)


def superblob(width, depth, height, roundness=3.0, top=2.5, shoulder=1.0, at=(0, 0, 0), sections=14):
    """A soft main form between a box and an egg, standing on a flat sole at z = 0, exactly width x depth x height.
    roundness: the outline seen from above (2 = oval, 3 = soft rounded box, 4-6 = boxy; a box-shaped parts room
    needs about 4 to fit its corners).
    top: how the sides curve into the top (2 = a full dome, 3 = a soft cushion, 5 = flat on top).
    shoulder: the share of the height that rounds over into the top (1 = the whole height, an egg or dome; 0.3 =
    upright sides with a soft top band, which holds a box-shaped parts room). Rounding cuts into the room inside, so
    start it above the room: shoulder = (HEIGHT - room height - 1) / HEIGHT, at least 0.
    Every setting works. Values outside the range are brought into it, and a band too low to round is built as
    straight sides; each such change is printed as a "superblob note" saying what was built and why."""
    for name, value in (("width", width), ("depth", depth), ("height", height)):
        if not value or value <= 0:
            raise ValueError(f"superblob {name} is {value} mm: give a size above 0 mm (the brief's room plus the walls)")
    asked = dict(roundness=roundness, top=top, shoulder=shoulder)
    roundness, top, shoulder = min(max(roundness, 2.0), 8.0), min(max(top, 2.0), 8.0), min(max(shoulder, 0.0), 1.0)
    for name, value in (("roundness", roundness), ("top", top), ("shoulder", shoulder)):
        if abs(value - asked[name]) > 1e-9:
            note("superblob", f"{name} {asked[name]} is outside its range, built with {value}")
    band = shoulder * height
    if band < MIN_BAND:
        note("superblob", f"a rounded top needs at least {MIN_BAND} mm of band height; shoulder {shoulder:g} gives "
                          f"{band:.1f} mm, so the sides go straight up and the top is flat. For a rounded top, raise "
                          f"shoulder to {MIN_BAND / height:.2f} or more (it needs that much spare height over the room).")
        sides = extrude(Face(_superellipse(width / 2, depth / 2, roundness, Plane.XY)), amount=height)
        return placed(step_safe(one_solid(sides, "superblob")), at)

    def build(a, b, reach, way):
        count, smooth, polygon, top_used = way
        start = reach * (1 - shoulder)
        piece = _blob_band(a, b, roundness, top_used, start, reach, count, smooth, polygon)
        if start > 0.5:
            # the upright sides: the band's own bottom face pushed straight down to the sole. Lofting them with the
            # band makes the smooth loft bulge outward, and a separately drawn outline overlapping it fuses invalid.
            bottom = piece.faces().sort_by(Axis.Z)[0]
            piece = fuse(piece, one_solid(Solid.extrude(bottom, Vector(0, 0, -start)), "superblob sides"), "superblob")
        return piece

    def sized(way):
        """The shape built one way, exactly the asked size, or None if that way fails."""
        a, b, reach = width / 2, depth / 2, height
        for _ in range(4):
            # a smooth loft bulges a little past its sections: rebuild with them pulled in by that much
            # (scaling the solid instead crashes OpenCascade on these lofts)
            try:
                body = step_safe(build(a, b, reach, way))   # measured as it will be saved
            except Exception:
                return None
            lo, hi = bounds(body)
            got = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
            if all(abs(g - w) <= 0.25 for g, w in zip(got, (width, depth, height))):
                return body
            if any(g > 1.15 * w for g, w in zip(got, (width, depth, height))):
                return None   # the loft swung far outside its sections: this way of lofting is unstable here
            a, b, reach = a * width / got[0], b * depth / got[1], reach * height / got[2]
        return None

    # ways to build it, best first: smooth; fewer slices; a faceted outline; a slightly less flat top; ruled (faceted)
    ways = [(sections, True, False, top), (10, True, False, top), (sections, True, True, top),
            (sections, True, False, min(top, 4.0)), (sections, False, True, top)]
    body = None
    for way in ways:
        body = sized(way)
        if body is not None:
            if way[3] != top:
                note("superblob", f"top {top:g} could not be lofted on this band, built with top {way[3]:g} (a little rounder)")
            elif not way[1]:
                note("superblob", "built with straight facets between slices: the smooth loft was unstable at these settings")
            break
    if body is None:
        note("superblob", f"these settings could not be rounded ({width:g} x {depth:g} x {height:g} mm, roundness {roundness:g}, "
                          f"top {top:g}, shoulder {shoulder:g}); built with straight sides and a flat top instead. "
                          "Try a lower top or a larger shoulder.")
        body = step_safe(one_solid(extrude(Face(_superellipse(width / 2, depth / 2, roundness, Plane.XY)), amount=height), "superblob"))
    return placed(body, at)


MIN_SPINE_POINTS = 6


def spine_body(spine, sizes, roundness=2.2, round_ends=True, at=(0, 0, 0)):
    """One smooth form along a spine: a body that flows into a tail, a neck or a nose with no seam.
    spine: points (x, z) from one end to the other, along the length (x), in the front's plane.
    sizes: (half depth along y, half height) of the cross-section at each spine point; make the ends small to taper.
    roundness: the cross-section shape (2 = oval, 3 = soft rounded box). round_ends: close each end in a soft dome
    (a small end closes in a point, so a tail or nose tapers to a tip). Cut the sole flat afterwards (flat_sole)."""
    assert len(spine) == len(sizes) >= 3, "spine_body needs at least 3 spine points, each with a size"
    # Fill in points between the given ones: a loft through only a few sections, closing in a point, can tessellate
    # into a broken mesh, so the spine always has at least MIN_SPINE_POINTS sections.
    spine, sizes = [tuple(p) for p in spine], [tuple(z) for z in sizes]
    while len(spine) < MIN_SPINE_POINTS:
        spine = [v for a_, b_ in zip(spine, spine[1:]) for v in (a_, tuple((p + q) / 2 for p, q in zip(a_, b_)))] + [spine[-1]]
        sizes = [v for a_, b_ in zip(sizes, sizes[1:]) for v in (a_, tuple((p + q) / 2 for p, q in zip(a_, b_)))] + [sizes[-1]]
    reach_out = max(max(d, h) for d, h in sizes)
    span = (min(x for x, _ in spine) - reach_out - 1, max(x for x, _ in spine) + reach_out + 1)
    tall = (min(z for _, z in spine) - reach_out - 1, max(z for _, z in spine) + reach_out + 1)

    def denser(points, wide):
        """Twice as many sections, each new one halfway between its neighbours."""
        pts_ = [v for a_, b_ in zip(points, points[1:]) for v in (a_, tuple((p + q) / 2 for p, q in zip(a_, b_)))] + [points[-1]]
        wide_ = [v for a_, b_ in zip(wide, wide[1:]) for v in (a_, tuple((p + q) / 2 for p, q in zip(a_, b_)))] + [wide[-1]]
        return pts_, wide_

    def eased(wide):
        """Sizes averaged with their neighbours (the ends kept), so a sudden jump does not make the loft swing."""
        return [wide[0]] + [tuple((p + 2 * q + r) / 4 for p, q, r in zip(*wide[i - 1:i + 2])) for i in range(1, len(wide) - 1)] + [wide[-1]]

    def build(points, wide, smooth):
        pts = [Vector(x, 0, z) for x, z in points]

        def tangent(i):
            return (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()

        def section(p, normal, half_d, half_h):
            # across the spine, with its local x along y (depth) and local y up the body
            return Face(_superellipse(max(half_d, 0.3), max(half_h, 0.3), roundness, Plane(origin=p, x_dir=(0, 1, 0), z_dir=normal)))

        def cap(i, outward):
            """Sections beyond end i that shrink like a quarter circle, ending in a point."""
            half_d, half_h = wide[i]
            reach = min(half_d, half_h) * 0.9
            out = []
            for k in (1, 2, 3):
                a = k / 4 * math.pi / 2
                out.append(section(pts[i] + outward * (reach * math.sin(a)), tangent(i), half_d * math.cos(a), half_h * math.cos(a)))
            return out, pts[i] + outward * reach

        faces = [section(p, tangent(i), *wide[i]) for i, p in enumerate(pts)]
        if round_ends:
            head, tip0 = cap(0, -tangent(0))
            tail, tip1 = cap(len(pts) - 1, tangent(len(pts) - 1))
            faces = [Vertex(*tip0)] + head[::-1] + faces + tail + [Vertex(*tip1)]
        body = step_safe(one_solid(loft(faces, ruled=not smooth), "spine_body"))
        lo, hi = bounds(body)
        if lo[0] < span[0] or hi[0] > span[1] or lo[2] < tall[0] or hi[2] > tall[1]:
            raise ValueError("the loft swung outside its sections")
        return body

    # ways to build it, best first: as given; more sections; sizes eased; faceted (ruled) as the last resort
    dense = denser(spine, sizes)
    ways = [("as given", spine, sizes, True), ("more sections", *dense, True),
            ("sizes eased", dense[0], eased(dense[1]), True), ("faceted", *dense, False)]
    for name, points, wide, smooth in ways:
        try:
            body = build(points, wide, smooth)
        except Exception:
            continue
        if name == "sizes eased":
            note("spine_body", "the sizes jump too much between neighbouring points for a smooth form, so they were "
                               "evened out a little; change the sizes more gradually to keep them exact")
        elif name == "faceted":
            note("spine_body", "built with straight facets between sections: the smooth form was unstable; change the "
                               "sizes more gradually or turn the spine less sharply")
        return placed(body, at)
    raise ValueError("spine_body could not make this form: the sizes or the spine's turns change too sharply between "
                     f"points (sizes up to {reach_out:.0f} mm on points as close as "
                     f"{min(abs(q[0] - p[0]) + abs(q[1] - p[1]) for p, q in zip(spine, spine[1:])):.0f} mm). Space the "
                     "points further apart or change the sizes more gradually.")


def max_round(slack_a, slack_b):
    """The biggest rounding radius (mm) whose curve still clears the parts' box, when the box sits slack_a and slack_b
    mm inside the outside on the two sides that meet at that edge (for example half the spare width and the spare height
    for the front's top corners). Round with this or less and the parts still fit."""
    a, b = max(0.0, slack_a), max(0.0, slack_b)
    return (a + b) + math.sqrt(2 * a * b)


def rounded_box(width, depth, height, radius, at=(0, 0, 0)):
    """A box with every edge rounded (falls back to smaller radii, never crashes): boxy robots, TVs, radios."""
    box = Box(width, depth, height)
    return placed(safe_fillet(box, box.edges(), radius, "rounded_box"), at)


# ---------- features built from the primitives ----------

def ear(width, height, thickness, at, tilt=(0, 0, 0), sharpness=0.25, sink=3.0, inner=True, lean=0.0):
    """A cat-style ear: a flat rounded triangle facing the front (-y), standing on +z before turning, its base `sink` mm
    below `at` so it roots into the body. sharpness: tip roundness as a share of the base (0.15 pointy cat, 0.5 round
    bear). lean: how far the tip leans sideways, as a share of the width (+ = toward +x). inner: a shallow inner-ear dip
    on the front face (needs thickness of at least 4 mm)."""
    assert width > 4 and height > 4 and thickness >= 2.5, "ear: at least 4 mm wide and tall, 2.5 mm thick"
    round_r = max(0.8, min(width, height) * sharpness * 0.5)
    tip_x = lean * width
    outline = Polygon((-width / 2 + round_r, -sink), (width / 2 - round_r, -sink), (tip_x, height - round_r * 1.6), align=None)
    face = offset(outline, round_r, kind=Kind.ARC)
    flat = Plane.XZ * face  # in the x-z plane, so it faces the front
    solid = one_solid(extrude(flat, thickness / 2, both=True), "ear plate")
    solid = safe_fillet(solid, solid.edges().filter_by(Axis.Y, reverse=True), min(thickness * 0.42, round_r * 0.9), "ear")
    if inner and thickness >= 4:
        dip = offset(Polygon((-width / 4, height * 0.12), (width / 4, height * 0.12), (tip_x * 0.6, height * 0.62), align=None),
                     round_r * 0.5, kind=Kind.ARC)
        cut = extrude(Plane.XZ.offset(thickness / 2 + 0.01) * dip, 1.2)
        try:
            carved = one_solid(solid - cut, "inner ear")
            if carved.volume > solid.volume * 0.8:
                solid = carved
        except Exception:
            pass
    return placed(solid, at, tilt)


def paw(width, depth, height, at, tilt=(0, 0, 0), toes=3, grooves=0):
    """A paw: a squashed dome with a row of toe beans along its front edge. Put `at` on the floor (z = 0) and cut the
    sole flat afterwards so the case still stands flat. Its middle sits 0.6 mm above `at`, so its widest outline never
    lines up with the body's flat bottom. toes=0 gives a plain dome. grooves=2 (with toes=0) carves soft toe lines into
    one rounded paw instead of separate beans: it reads as a paw and looks moulded, not stuck on."""
    x, y, z = at[0], at[1], at[2] + 0.6
    pad = scale(Sphere(1), by=(width / 2, depth / 2, height))
    if grooves:
        # Toe lobes merged into the pad: the soft valleys between them are the toe lines.
        lobes = grooves + 1
        lw = width / lobes * 0.68
        for i in range(lobes):
            lx = (i + 0.5) / lobes * width - width / 2
            lobe = Pos(lx * 0.9, -depth * 0.14, 0) * scale(Sphere(1), by=(lw, depth * 0.36, height * 0.97))
            pad = fuse(pad, lobe, "paw lobe")
    if toes:
        bean = min(width / (toes * 2.2), height * 0.55)
        for i in range(toes):
            t = 0.5 if toes == 1 else i / (toes - 1)
            bx = (t - 0.5) * width * 0.62
            toe = Pos(bx, -depth * 0.36, height * 0.42) * scale(Sphere(1), by=(bean, bean * 0.9, bean * 0.85))
            pad = fuse(pad, toe, "paw toe")
    return placed(one_solid(pad, "paw"), (x, y, z), tilt)


def antenna(height, stalk_radius=1.6, ball_radius=3.5, at=(0, 0, 0), tilt=(0, 0, 0), sink=3.0):
    """A stalk with a ball on top, standing on +z, rooted `sink` mm into the body."""
    stalk = Pos(0, 0, (height - sink) / 2) * Cylinder(stalk_radius, height + sink)
    return placed(fuse(stalk, Pos(0, 0, height) * Sphere(ball_radius), "antenna"), at, tilt)


def spike_row(count, base_radius, height, start, end, tilt=(0, 0, 0)):
    """Evenly spaced cone_tips from start to end (each an (x, y, z) on the surface): dino spikes, crowns, hair."""
    assert count >= 1
    parts = []
    for i in range(count):
        t = 0.5 if count == 1 else i / (count - 1)
        p = tuple(a + (b - a) * t for a, b in zip(start, end))
        parts.append(cone_tip(base_radius, height, at=(p[0], p[1], p[2] - base_radius * 0.6), tilt=tilt))
    return parts


# ---------- reading the body's surface, so features land on it ----------

NUDGES = ((0.0, 0.0), (0.04, 0.03), (-0.05, 0.02), (0.02, -0.06))   # mm: a ray exactly through a closing point fails


def _hits(body, origin, direction, along):
    """Hit coordinates along one axis for a ray, nudged a hair off a point where the surface closes (a dome's top)."""
    for du, dv in NUDGES:
        o = [origin[0], origin[1], origin[2]]
        free = [i for i in range(3) if i != along]
        o[free[0]] += du
        o[free[1]] += dv
        try:
            hits = body.find_intersection_points(Axis(tuple(o), direction))
        except Exception:
            continue
        pts = [p for p, _ in hits] if hits and isinstance(hits[0], tuple) else list(hits)
        return [(p.X, p.Y, p.Z)[along] for p in pts]
    return []


def surface_z(body, x, y):
    """The top of the body above (x, y), or None if the body is not there."""
    zs = _hits(body, (x, y, BIG / 2), (0, 0, -1), 2)
    return max(zs) if zs else None


def surface_x(body, y, z, side=+1):
    """The body's right (side=+1) or left (side=-1) side at height z, depth y."""
    xs = _hits(body, (side * BIG / 2, y, z), (-side, 0, 0), 0)
    return (max(xs) if side > 0 else min(xs)) if xs else None


def surface_y_front(body, x, z):
    """The front of the body (smallest y) at (x, z)."""
    ys = _hits(body, (x, -BIG / 2, z), (0, 1, 0), 1)
    return min(ys) if ys else None


# ---------- features that grow out of the body ----------

def surface_normal(body, point):
    """The outward direction of the body's surface nearest `point` (a unit (x, y, z))."""
    p = Vector(*point)
    face = min(body.faces(), key=lambda f: f.distance_to(p))
    n = face.normal_at(p)
    centre = body.center()
    if n.dot(p - centre) < 0:
        n = -n
    return (n.X, n.Y, n.Z)


def _frame(direction, side):
    """Unit vectors (along, across, thickness) for sections square to `direction`, `across` as close to `side` as it can be."""
    d = Vector(*direction).normalized()
    s = Vector(*side)
    s = s - d * s.dot(d)
    if s.length < 1e-6:
        s = Vector(0, 1, 0) if abs(d.Y) < 0.9 else Vector(1, 0, 0)
        s = s - d * s.dot(d)
    s = s.normalized()
    return d, s, d.cross(s).normalized()


def _height_under(body, origin, d, offset_vec):
    """How far along d the body's surface is at origin + offset_vec (negative: below origin), or None if not there."""
    for nudge in (Vector(0, 0, 0), Vector(0.04, 0.03, 0.02), Vector(-0.05, 0.02, -0.03)):
        start = origin + offset_vec + d * 60 + nudge
        try:
            hits = body.find_intersection_points(Axis(start, -d))
        except Exception:
            continue
        pts = [p for p, _ in hits] if hits and isinstance(hits[0], tuple) else list(hits)
        return max((q - origin).dot(d) for q in pts) if pts else None
    return None


def grow(body, name, at, profile, added, skipped, direction=None, side=(1, 0, 0), roundness=2.2, flare=1.7, tip=True):
    """A feature grown out of the body as one smooth piece: ears, horns, fins, tails, legs, snouts, antennas, spikes.
    It starts as a wide base sunk under the surface, flares up through it, then follows `profile` out to its tip, so it
    reads as part of the body (no seam, no fillet needed). Joins it like try_join and returns the body.
    at: a point on the surface (from surface_z, surface_x or surface_y_front).
    profile: [(distance out, half width, half thickness), ...] from the root to the tip, distances rising; a fourth
      number leans that section sideways (mm along `side`). Example ear: [(0, 10, 5), (8, 7, 4), (15, 2, 1.5)]. The
      base adds about half the first section's smaller size below the profile, where it flares into the body.
    direction: which way it grows (default: straight out of the surface at `at`). side: the direction its width runs
      (default x, across the front). roundness: the cross-section (2 oval, 3 soft rounded box). flare: how much wider
      than the first profile section the root is, so it blends into the body (1 = no blend). tip: close in a round tip.
    A change to what was asked (a lower flare, faceted) is printed as a "grow note"."""
    try:
        if len(profile) < 2:
            raise ValueError(f"{name}: give the profile at least 2 sections, from the root to the tip")
        ts = [float(p[0]) for p in profile]
        if any(b <= a for a, b in zip(ts, ts[1:])):
            raise ValueError(f"{name}: the profile's distances must rise from the root to the tip (got {ts})")
        if min(min(p[1], p[2]) for p in profile) <= 0:
            raise ValueError(f"{name}: every half width and half thickness must be above 0 mm")
        origin = Vector(*at)
        d, s, t = _frame(direction or surface_normal(body, at), side)
        w0, h0 = profile[0][1], profile[0][2]

        def depth_under(scale_):
            """The lowest the surface falls (along d) under a ring scale_ times the root section, minus a margin."""
            heights = []
            for k in range(12):
                ang = 2 * math.pi * k / 12
                h = _height_under(body, origin, d, s * (w0 * scale_ * math.cos(ang)) + t * (h0 * scale_ * math.sin(ang)))
                heights.append(h if h is not None else -2 * max(w0, h0))
            return min(heights)

        def section(dist, a, b, lean=0.0):
            centre = origin + d * dist + s * lean
            return Face(_superellipse(max(a, 0.3), max(b, 0.3), roundness, Plane(origin=centre, x_dir=s, z_dir=d)))

        prof = [(p[0], p[1], p[2], p[3] if len(p) > 3 else 0.0) for p in profile]

        def within(piece, faces, margin=1.5):
            """True if the loft stays inside the box around its own sections: beyond that it swung."""
            lo_e, hi_e = [1e9] * 3, [-1e9] * 3
            for f in faces:
                bb = f.bounding_box()
                lo_e = [min(x, y) for x, y in zip(lo_e, (bb.min.X, bb.min.Y, bb.min.Z))]
                hi_e = [max(x, y) for x, y in zip(hi_e, (bb.max.X, bb.max.Y, bb.max.Z))]
            lo, hi = bounds(piece)
            return all(l >= e - margin for l, e in zip(lo, lo_e)) and all(h <= e + margin for h, e in zip(hi, hi_e))

        def build(flare_, smooth):
            # three short pieces, each through only a few sections (a smooth loft through many wiggles):
            # the flaring base, the profile, and a round tip
            rise = 0.5 * min(w0, h0) if flare_ > 1.01 else 0.0
            shifted = [(t_ + rise, a_, b_, l_) for t_, a_, b_, l_ in prof]
            parts = []
            if flare_ > 1.01:
                mid = 1 + (flare_ - 1) * 0.35
                root_t = min(depth_under(flare_), 0.0) - 2.0
                mid_t = max(min(depth_under(mid), 0.0) - 0.4, root_t + 0.5)
                base_faces = [section(root_t, w0 * flare_, h0 * flare_), section(mid_t, w0 * mid, h0 * mid), section(*shifted[0])]
            else:
                base_faces = [section(min(depth_under(1.0), 0.0) - 1.5, w0, h0), section(*shifted[0])]
            base = one_solid(loft(base_faces, ruled=not smooth), name)
            if not within(base, base_faces):
                raise ValueError("the base swung outside its sections")
            parts.append(base)
            # the profile starts 1 mm inside the base, so the two overlap and fuse into one solid
            first = shifted[0]
            body_faces = [section(first[0] - 1.0, first[1], first[2], first[3])] + [section(*r) for r in shifted[1:]]
            stem = one_solid(loft(body_faces, ruled=not smooth or len(body_faces) == 2), name)
            if not within(stem, body_faces):
                raise ValueError("the profile swung outside its sections")
            parts.append(stem)
            if tip:
                t_, a_, b_, l_ = shifted[-1]
                reach = min(a_, b_) * 0.85
                # centred 0.5 mm inside the last section, so it overlaps the profile and fuses into one solid
                frame = Plane(origin=origin + d * (t_ - 0.5) + s * l_, x_dir=s, z_dir=d)
                parts.append(one_solid(frame.location * scale(Sphere(1), by=(max(a_, 0.3), max(b_, 0.3), max(reach, 0.3))), name))
            piece = parts[0]
            for part in parts[1:]:
                piece = fuse(piece, part, name)
            return piece

        piece, used = None, None
        for flare_, smooth in ((flare, True), (1 + (flare - 1) * 0.6, True), (1.0, True), (flare, False), (1.0, False)):
            try:
                piece, used = build(flare_, smooth), (flare_, smooth)
                break
            except Exception:
                continue
        if piece is None:
            raise ValueError(f"{name}: no smooth form through this profile; change the sizes more gradually")
        if used[0] < flare - 1e-6:
            note("grow", f"{name}: the base blends less than asked (flare {used[0]:.2f} instead of {flare:g}): the surface "
                         "curves too much under it; move it to a flatter spot for a softer blend")
        if not used[1]:
            note("grow", f"{name}: built with straight facets: change the profile's sizes more gradually for a smooth one")
    except ValueError as error:
        skipped.append(f"{name}: {error}")
        return body
    return try_join(body, piece, name, added, skipped)


# ---------- joins and finishing ----------

def safe_fillet(solid, edges, radius, name="part"):
    """Round edges, trying smaller radii if needed. Returns the unrounded solid rather than crashing."""
    for r in (radius, radius * 0.6, radius * 0.35, radius * 0.2):
        try:
            out = fillet(edges, r)
            if out.is_valid:
                return one_solid(out, name)
        except Exception:
            pass
    return one_solid(solid, name)


def join(body, feature, name, min_overlap=2.0):
    """Fuse a feature that sinks into the body. Raises if it only touches (a pinched edge) or floats."""
    try:
        overlap = (body & feature).volume
    except Exception:
        overlap = 0.0
    assert overlap >= min_overlap, f"{name} overlaps the body by only {overlap:.1f} mm3; sink it deeper"
    return fuse(body, feature, name)


def try_join(body, feature, name, added, skipped, min_overlap=2.0):
    """Like join, but a feature that fails is left out and named in `skipped` instead of crashing the body.
    Records how much of the feature stands outside the body, for feature_report()."""
    if not CORE:
        lo, hi = bounds(body)
        CORE["size_mm"] = [round(h - l, 1) for l, h in zip(lo, hi)]
    try:
        before = body.volume
        body = join(body, feature, name, min_overlap)
        added.append(name)
        lo, hi = bounds(feature)
        JOINED[name] = {"outside_mm3": round(body.volume - before, 1), "size_mm": [round(h - l, 1) for l, h in zip(lo, hi)]}
    except Exception as error:
        skipped.append(f"{name}: {error}")
    return body


def flat_sole(body, z=0.0):
    """Cut everything below z, so the body stands flat (paws and feet become flat-bottomed)."""
    return one_solid(body - Pos(0, 0, z - BIG / 2) * Box(BIG, BIG, BIG), "flat sole")


def flat_back(body, y):
    """Cut everything behind y (the rear cover goes there)."""
    return one_solid(body - Pos(0, y + BIG / 2, 0) * Box(BIG, BIG, BIG), "flat back")


def bounds(body):
    """Exact bounds from the tessellated surface ((x0, y0, z0), (x1, y1, z1)), to about 0.1 mm.
    OpenCascade's bounding_box() can be several mm loose on curved surfaces, so never size or check with it."""
    points = None
    for tolerance, angle in ((0.1, 0.3), (0.2, 0.5), (0.5, 0.8)):
        try:
            points, _ = body.tessellate(tolerance, angle)
            break
        except Exception:
            continue
    if not points:
        b = body.bounding_box()
        return (b.min.X, b.min.Y, b.min.Z), (b.max.X, b.max.Y, b.max.Z)
    xs, ys, zs = [p.X for p in points], [p.Y for p in points], [p.Z for p in points]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def feature_report():
    """One line to print at the end of a body script, so the rules can see each feature's visible size."""
    import json
    return "features: " + json.dumps(JOINED) + "\ncore: " + json.dumps(CORE.get("size_mm"))


def section_area(body, y, thickness=0.2):
    """Area (mm2) of the body's cross-section at depth y."""
    try:
        return (body & Pos(0, y, 0) * Box(BIG, thickness, BIG)).volume / thickness
    except Exception:
        return 0.0


def _hull_area(points):
    """Area (mm2) of the convex outline of (x, z) points."""
    from scipy.spatial import ConvexHull
    try:
        return float(ConvexHull(points).volume) if len(points) >= 3 else 0.0
    except Exception:
        return 0.0


def _back_outline(body):
    """Points (x, z) of the body seen from the back: its whole outline, features included."""
    points, _ = body.tessellate(0.2, 0.5)
    return [(p.X, p.Z) for p in points]


def broad_flat_back(body, share=0.65, step=1.0, max_cut=25.0):
    """Cut the back flat, moving the cut forward until the flat plate covers at least `share` of the body's outline
    seen from the back (ears, tails and fins count, as in the back-plate rule), so the rear cover is broad, prints flat
    and has room for screws. Returns (body, y of the cut)."""
    lo, hi = bounds(body)
    outline = _hull_area(_back_outline(body))

    def plate(y):
        try:
            slab = body & Pos(0, y, 0) * Box(BIG, 0.2, BIG)
            return _hull_area(_back_outline(slab))
        except Exception:
            return 0.0
    y = hi[1] - step
    while y > hi[1] - max_cut and plate(y) < share * outline:
        y -= step
    return flat_back(body, y), y


def size(body):
    lo, hi = bounds(body)
    return tuple(round(h - l, 1) for l, h in zip(lo, hi))
