"""Worked example: a loaf kitten body from simple solids (body_parts). Front faces -y. Every size is a setting."""
from body_parts import broad_flat_back, ear, flat_sole, oval_loft, paw, size, surface_y_front, surface_z, try_join

WIDTH, DEPTH, HEIGHT = 112.0, 68.0, 62.0          # the main form; meet the limits you were given
EAR = dict(width=26.0, height=19.0, thickness=10.0, sharpness=0.3)
EAR_X, EAR_Y, EAR_TILT = 0.30 * WIDTH, 2.0, 14     # ears near the top corners, leaning outward
PAW = dict(width=22.0, depth=20.0, height=10.0)
PAW_X, PAW_SINK = 0.34 * WIDTH, 6.0               # front paws at the bottom front corners, sunk 6 mm into the front

rx, ry = WIDTH / 2, DEPTH / 2
# A loaf: full at the bottom, with a soft domed top. The top two ovals are the same size, so the sides are
# upright where the dome starts and the dome meets them without a ridge.
body = oval_loft([(0, rx * 0.93, ry * 0.93), (HEIGHT * 0.2, rx, ry), (HEIGHT * 0.45, rx * 0.99, ry * 0.99),
                  (HEIGHT * 0.6, rx * 0.99, ry * 0.99)], dome=HEIGHT * 0.4)

added, skipped = [], []
# Name each feature exactly as the feature list names it: the rule checks these names.
for side, name in ((-1, "left ear"), (1, "right ear")):
    x = side * EAR_X
    z = surface_z(body, x, EAR_Y)
    body = try_join(body, ear(**EAR, at=(x, EAR_Y, z), tilt=(0, side * EAR_TILT, 0)), name, added, skipped)
for side, name in ((-1, "left paw"), (1, "right paw")):
    # Read where the front is at the paw's spot: an oval body curves back at its corners.
    x = side * PAW_X
    y = surface_y_front(body, x, PAW["height"] * 0.5) - PAW["depth"] / 2 + PAW_SINK
    body = try_join(body, paw(**PAW, at=(x, y, 0)), name, added, skipped)

# The back is cut flat, moving forward until the plate is broad (the rear cover goes there).
body, back_y = broad_flat_back(flat_sole(body), share=0.75)
print("added:", added, "skipped:", skipped, "size:", size(body), "back cut at y =", round(back_y, 1))
