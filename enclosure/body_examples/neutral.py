"""Worked example: the method, not a character. A soft main form sized from the parts' room, then features grown
out of it one kind at a time, then the flat back. Copy the method; take every size from your own brief.
Front faces -y. Every size is a setting."""
from body_parts import (broad_flat_back, ear, feature_report, flat_sole, size, spine_body, superblob, surface_x, surface_z,
                        try_join)

ROOM = dict(width=100.0, depth=42.0, height=50.0)  # the parts' room from the brief (walls included): copy its numbers
WIDTH, DEPTH, HEIGHT = 108.0, 60.0, 66.0           # the main form: inside the front limits, with height to spare over
                                                   # ROOM, because the soft top must start above the room inside

# 1. The main form. superblob for a rounded body. roundness: the outline from above (2 oval .. 5 boxy; about 4 holds a
#    box-shaped room). top: how the top curves (2 dome .. 5 flat). shoulder: the share of the height that rounds over;
#    start the rounding just above the room, so the room stays inside: shoulder = 1 - (room height + 1) / HEIGHT.
#    For a long body that flows into a tail, neck or nose, use spine_body instead, for example:
#    body = flat_sole(spine_body([(-55, 26), (-20, 28), (20, 27), (50, 24), (68, 34)],
#                                [(30, 26), (30, 28), (29, 27), (16, 14), (5, 5)]))
SHOULDER = 1 - (ROOM["height"] + 1) / HEIGHT
body = superblob(WIDTH, DEPTH, HEIGHT, roundness=4.0, top=2.5, shoulder=SHOULDER)
print("core:", list(size(body)))                   # the main form's size, before any feature (the proportion rule)

added, skipped = [], []
# 2. Features, one kind per build, each named exactly as the brief's feature list names it.
#    Read the surface where a feature goes; sink its root in so it grows out of the body rather than sitting on it.
for side, name in ((-1, "left horn"), (1, "right horn")):
    x = side * 0.28 * WIDTH
    z = surface_z(body, x, 0.0)
    horn = ear(width=20.0, height=14.0, thickness=12.0, sharpness=0.6, at=(x, 0.0, z), tilt=(0, side * 12, 0), sink=6.0)
    body = try_join(body, horn, name, added, skipped)

# A tail from spine_body: a short tapered form rooted in the side (keep features off the side where the USB opens).
x_side = surface_x(body, 6.0, 22.0, side=+1)
tail = spine_body([(x_side - 8, 20), (x_side + 6, 22), (x_side + 16, 30)], [(9, 8), (6, 6), (3, 3)])
body = try_join(body, tail, "tail", added, skipped)

# 3. The sole and the back plate last: the cover is cut flat from the back, the rim around it stays soft.
body, back_y = broad_flat_back(flat_sole(body), share=0.65)
print("added:", added, "skipped:", skipped, "size:", size(body), "back cut at y =", round(back_y, 1))
print(feature_report())
