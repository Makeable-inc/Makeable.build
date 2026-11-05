"""Tested building blocks for character bodies: simple closed solids that always build, and joins that check
themselves. A body script imports these instead of writing risky surfacing code.

Units are mm, world +z up, the front faces -y, the body stands on z = 0. Every function returns one valid solid
or raises a clear error; `try_join` never raises, so one awkward feature never sinks the whole body.
"""
import math

from build123d import (Axis, Box, Cone, Cylinder, Ellipse, Kind, Circle, Plane, Polygon, Pos, Rectangle, RectangleRounded, Rot, Sphere, extrude,
                       fillet, loft,
                       offset, scale, Solid)

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
    """A cone with a rounded tip, base at z = 0 before turning: horns, spikes, beaks, rocket noses."""
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

def surface_z(body, x, y):
    """The top of the body above (x, y), or None if the body is not there."""
    hits = body.find_intersection_points(Axis((x, y, BIG / 2), (0, 0, -1)))
    zs = [p.Z for p, _ in hits] if hits and isinstance(hits[0], tuple) else [p.Z for p in hits]
    return max(zs) if zs else None


def surface_x(body, y, z, side=+1):
    """The body's right (side=+1) or left (side=-1) side at height z, depth y."""
    hits = body.find_intersection_points(Axis((side * BIG / 2, y, z), (-side, 0, 0)))
    xs = [p.X for p, _ in hits] if hits and isinstance(hits[0], tuple) else [p.X for p in hits]
    return (max(xs) if side > 0 else min(xs)) if xs else None


def surface_y_front(body, x, z):
    """The front of the body (smallest y) at (x, z)."""
    hits = body.find_intersection_points(Axis((x, -BIG / 2, z), (0, 1, 0)))
    ys = [p.Y for p, _ in hits] if hits and isinstance(hits[0], tuple) else [p.Y for p in hits]
    return min(ys) if ys else None


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


def broad_flat_back(body, share=0.8, step=1.0, max_cut=25.0):
    """Cut the back flat, moving the cut forward until the flat plate is at least `share` of the body's biggest
    cross-section, so the rear cover is broad, prints flat and has room for screws. Returns (body, y of the cut)."""
    lo, hi = bounds(body)
    biggest = max(section_area(body, lo[1] + f * (hi[1] - lo[1])) for f in (0.3, 0.45, 0.6, 0.75))
    y = hi[1] - step
    while y > hi[1] - max_cut and section_area(body, y) < share * biggest:
        y -= step
    return flat_back(body, y), y


def size(body):
    lo, hi = bounds(body)
    return tuple(round(h - l, 1) for l, h in zip(lo, hi))
