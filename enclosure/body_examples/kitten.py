"""Worked example: a loaf kitten body from simple solids (body_parts). Front faces -y. Every size is a setting."""
from body_parts import broad_flat_back, ear, flat_sole, paw, rounded_loft, size, surface_y_front, surface_z, try_join

WIDTH, DEPTH, HEIGHT = 108.0, 62.0, 56.0          # the main form: roomy enough for the parts box, inside the front limits
DOME = 3.0                                         # a low dome, so the front stays under its height limit with the ears
EAR = dict(width=24.0, height=11.0, thickness=7.0, sharpness=0.35)  # short ears: they count in the front height
EAR_X, EAR_Y, EAR_TILT = 0.30 * WIDTH, 2.0, 14     # ears near the top corners, leaning outward
PAW = dict(width=22.0, depth=20.0, height=10.0)
PAW_X, PAW_SINK = 0.34 * WIDTH, 6.0               # front paws at the bottom front corners, sunk 6 mm into the front

R = 5.5                                           # corner radius seen from above: small enough to keep the parts box inside
# A loaf: rounded-rectangle sections (roomy inside, soft outside), a little fuller at the bottom, with a domed top.
# The top two sections are the same size, so the dome meets the upright sides without a ridge.
body = rounded_loft([(0, WIDTH, DEPTH, R), (HEIGHT * 0.25, WIDTH, DEPTH, R),
                     (HEIGHT * 0.75, WIDTH, DEPTH, R), (HEIGHT, WIDTH, DEPTH, R)], dome=DOME)

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
