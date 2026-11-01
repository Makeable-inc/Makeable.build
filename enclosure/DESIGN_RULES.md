# Design rules

Standing rules for every design script. Use build123d 0.13, millimetres, world +z up, with the case on a desk at its lowest z.

## Shapes and the calls that go wrong

Boolean results and `split` can return a `Compound`, and `.solids()` returns a `ShapeList`. A `ShapeList` has no `.cut`, `.clean` or `.fuse`. Use `-` and `+` on single shapes, and pull out the solid with this helper.

```python
from build123d import Box, Cylinder, Plane, Pos, Rot, Keep, split, export_stl, export_step, import_step

def one_solid(shape, name="part"):
    solids = shape.solids()
    assert len(solids) == 1, f"{name} has {len(solids)} solids, expected 1"
    return solids[0]

block = Pos(0, 0, 10) * Box(40, 30, 20)
hole = Pos(0, 0, 10) * Cylinder(5, 40)
part = one_solid(block - hole, "block")
```

To cut with many tools, join them first and cut once. It is much faster than cutting one at a time.

```python
tools = Pos(-12, 0, 10) * Cylinder(2, 40) + Pos(12, 0, 10) * Cylinder(2, 40) + Pos(0, 10, 10) * Cylinder(2, 40)
part = one_solid(block - tools, "block")
```

To split at a flat seam, cut with a large box. This is the most reliable way.

```python
seam_y, gap = 5.0, 0.15
front = one_solid(block - (Pos(0, seam_y + 100, 10) * Box(400, 200, 400)), "front")
back = one_solid(block - (Pos(0, seam_y + gap - 100, 10) * Box(400, 200, 400)), "back")
assert abs(front.bounding_box().max.Y - seam_y) < 0.001
assert abs(back.bounding_box().min.Y - (seam_y + gap)) < 0.001
```

Cylinders run along z. `Rot(X=90)` turns one to run along y.

```python
along_y = Pos(0, -10, 10) * (Rot(X=90) * Cylinder(3, 30))
assert abs(along_y.bounding_box().size.Y - 30) < 0.001
```

In design.json a part's transform is a 4 x 4 list of plain numbers. Apply the same turn to the geometry. `Rot(X=90)` matches the matrix below, which turns a part's +z to world -y.

```python
turned = Rot(X=90) * Box(10, 20, 30)
size = turned.bounding_box().size
assert abs(size.Y - 30) < 0.001 and abs(size.Z - 20) < 0.001
matrix = [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]
```

A smooth loft can bulge past its end sections, so do not trust it to stop at z = 0. Give every curved body a flat sole by cutting off everything below it, and test sizes with a small tolerance, not exact numbers.

```python
curved = Pos(0, 0, 9) * Box(40, 30, 20)
curved = one_solid(curved - (Pos(0, 0, -100) * Box(400, 400, 200)), "body")
assert abs(curved.bounding_box().min.Z) < 0.05
```

Do not chain calls on a result you have not checked. Some calls return nothing or several pieces. Keep each step in its own named variable and pass it through `one_solid`.

## Keep the script fast

The script has a time limit, and curved bodies are slow.
- Never rebuild a frozen body. Load it once with `import_step`.
- Build plain tools from boxes and cylinders, join them, then cut once.
- Do not fillet after cutting into a curved body. Fillet small plain parts before they join.
- Do at most a few booleans against the curved body.
- Check as you go, with `one_solid` after each main step, so a failure names the step.

## Valid parts

- Two surfaces that only touch along a line make a pinched edge. Make cuts overlap by at least 0.3 mm, or separate them.
- Posts and ribs overlap their wall by at least 1 mm, so they stay one solid.
- A wall strip left by a cut must be thick enough. Remove a thin strip completely.
- Openings are closed holes fitted to their part, never slots running to the seam.
- Parts slide straight in along the assembly direction, so the inside of a part must never get narrower along that path. On a curved body, make the cavity straight-sided along the assembly direction, and make it just big enough for the widest thing passing through. Check each part's width against the opening it has to pass.
- Before placing a post, rib or stop, look along the assembly direction of the part it is on. That part sweeps its whole inside over everything already installed, so a feature that clears in the final position can still hit on the way in. Keep these features outside the outline of the installed parts as seen along that direction, and trim or move whichever one is cheaper.
- In the closed case, every part must be stopped in every direction, including the one it went in from. A board whose front sits against the front wall is stopped by that wall. A small board with nothing in front of it, such as a controller behind a separate screen, is not. Give it a post, rib or clip within 0.5 mm of it on that side, usually on the part that closes over it, and keep that feature clear of the path everything travels on the way in.
- Mating parts need at least 0.1 mm of gap everywhere. This is a must-pass, and it applies to printed parts and to the parts they hold.
- Printers build up from a flat bed, layer by layer, so every printed part needs one side that sits flat. The rear cover is a flat plate of even thickness: its outside is completely flat, and only its outline is rounded. Screw recesses are the only cuts in that face.
- Screws must work: a clear hole, a screwdriver path, plastic under the head, and a real post around the pilot hole.
- Screws must fasten the whole cover. Put them near the corners, spread evenly, with at least one in each half of the cover's width and of its height. Two screws on one side leave the other side free to lift, so three or four is usual. Plan the posts for this early, because they need room inside.

## Exporting

```python
export_stl(part, "rules_check.stl", tolerance=0.01)
export_step(part, "rules_check.step")
loaded = one_solid(import_step("rules_check.step"), "loaded")
assert abs(loaded.volume - part.volume) < 1
```
