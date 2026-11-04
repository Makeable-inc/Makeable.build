"""Worked example: a loaf kitten body from simple solids (body_parts). Front faces -y. Every size is a setting."""
from body_parts import ear, flat_back, flat_sole, oval_loft, paw, size, surface_z, try_join

WIDTH, DEPTH, HEIGHT = 112.0, 68.0, 62.0          # the main form; meet the limits you were given
EAR = dict(width=26.0, height=19.0, thickness=10.0, sharpness=0.3)
EAR_X, EAR_Y, EAR_TILT = 0.30 * WIDTH, 2.0, 14     # ears near the top corners, leaning outward
PAW = dict(width=20.0, depth=18.0, height=9.0)
PAW_X, PAW_Y = 0.36 * WIDTH, -DEPTH / 2 + 6        # front paws at the bottom front corners
BACK_Y = DEPTH / 2 - 2                             # the back is cut flat here

rx, ry = WIDTH / 2, DEPTH / 2
# A loaf: full at the bottom, with a soft domed top. The top two ovals are the same size, so the sides are
# upright where the dome starts and the dome meets them without a ridge.
body = oval_loft([(0, rx * 0.93, ry * 0.93), (HEIGHT * 0.2, rx, ry), (HEIGHT * 0.45, rx * 0.99, ry * 0.99),
                  (HEIGHT * 0.6, rx * 0.99, ry * 0.99)], dome=HEIGHT * 0.4)

added, skipped = [], []
for side in (-1, 1):
    x = side * EAR_X
    z = surface_z(body, x, EAR_Y)
    body = try_join(body, ear(**EAR, at=(x, EAR_Y, z), tilt=(0, side * EAR_TILT, 0)), f"ear {side}", added, skipped)
for side in (-1, 1):
    body = try_join(body, paw(**PAW, at=(side * PAW_X, PAW_Y, 0)), f"paw {side}", added, skipped)

body = flat_back(flat_sole(body), BACK_Y)
print("added:", added, "skipped:", skipped, "size:", size(body))
