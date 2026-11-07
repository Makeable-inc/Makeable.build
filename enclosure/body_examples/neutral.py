"""Worked example: the method, not a character. A soft main form sized from the parts' room, then features grown
out of it one kind at a time, then the flat back. Copy the method; take every size from your own brief.
Front faces -y. Every size is a setting."""
from body_parts import broad_flat_back, feature_report, flat_sole, grow, size, superblob, surface_x, surface_z

ROOM = dict(width=100.0, depth=42.0, height=50.0)  # the parts' room from the brief (walls included): copy its numbers
WIDTH, DEPTH, HEIGHT = 108.0, 60.0, 66.0           # the main form: inside the front limits, with height to spare over
                                                   # ROOM, because the soft top must start above the room inside

# 1. The main form. superblob for a rounded body. roundness: the outline from above (2 oval .. 5 boxy; about 4 holds a
#    box-shaped room). top: how the top curves (2 dome .. 5 flat). shoulder: the share of the height that rounds over;
#    start the rounding just above the room, so the room stays inside: shoulder = (HEIGHT - room height - 1) / HEIGHT, at least 0.
#    With no spare height over the room it is 0: straight sides, and the build prints a note saying so.
#    For a long body that flows into a tail, neck or nose, use spine_body instead, for example:
#    body = flat_sole(spine_body([(-55, 26), (-20, 28), (20, 27), (50, 24), (68, 34)],
#                                [(30, 26), (30, 28), (29, 27), (16, 14), (5, 5)]))
SHOULDER = max(0.0, (HEIGHT - ROOM["height"] - 1) / HEIGHT)
body = superblob(WIDTH, DEPTH, HEIGHT, roundness=4.0, top=2.5, shoulder=SHOULDER)
print("core:", list(size(body)))                   # the main form's size, before any feature (the proportion rule)

added, skipped = [], []
# 2. Features, one kind per build, each named exactly as the brief's feature list names it. grow() reads the surface
#    around `at` and flares the base into the body; the profile is (distance out, half width, half thickness[, lean])
#    from the root to the tip.
for side, name in ((-1, "left horn"), (1, "right horn")):
    x = side * 0.28 * WIDTH
    body = grow(body, name, (x, 0.0, surface_z(body, x, 0.0)),
                [(0, 9.0, 6.0), (7, 6.0, 4.5, side * 1.5), (14, 2.5, 2.0, side * 3.0)], added, skipped)

# A tail on the right side (keep features off the side where the USB opens), growing out and up, then curling.
z = 24.0
body = grow(body, "tail", (surface_x(body, 6.0, z, side=+1), 6.0, z),
            [(0, 7.0, 6.0), (10, 5.0, 4.5), (20, 3.0, 3.0, 6.0)], added, skipped, direction=(1, 0, 0.5), side=(0, 0, 1))

# 3. The sole and the back plate last: the cover is cut flat from the back, the rim around it stays soft.
body, back_y = broad_flat_back(flat_sole(body), share=0.65)
print("added:", added, "skipped:", skipped, "size:", size(body), "back cut at y =", round(back_y, 1))
print(feature_report())
