"""Worked example: a loaf kitten body from simple solids (body_parts). Front faces -y. Every size is a setting."""
from body_parts import (broad_flat_back, ear, feature_report, flat_sole, max_round, paw, size, soft_box, surface_y_front,
                        surface_z, try_join)

ROOM = dict(width=101.0, depth=42.0, height=53.0)  # the parts' room from the brief (walls included): copy its numbers
WIDTH, DEPTH, HEIGHT = 110.0, 64.0, 58.0           # the main form: the front limits first, then a few mm over ROOM
# Soft from every side: the biggest roll that still clears the parts' box. The box sits just behind the front, so the
# tightest edges are the front's: spare width per side (or spare height) against about 1 mm spare at the front.
ROUND = 0.95 * max_round(min((WIDTH - ROOM["width"]) / 2, HEIGHT - ROOM["height"]), 1.0)
EAR = dict(width=28.0, height=12.0, thickness=13.0, sharpness=0.4)  # broad, thick, round-tipped ears rooted in the head
EAR_X, EAR_Y, EAR_TILT = 0.30 * WIDTH, 0.0, 16     # on the shoulders of the soft top, leaning outward
PAW = dict(width=24.0, depth=20.0, height=11.0, toes=0, grooves=2)  # one rounded paw with toe lines, not beads
PAW_X, PAW_SINK = 0.34 * WIDTH, 6.0               # front paws at the bottom front corners, sunk 6 mm into the front

body = soft_box(WIDTH, DEPTH, HEIGHT, radius=ROUND)

added, skipped = [], []
# Name each feature exactly as the feature list names it: the rule checks these names.
for side, name in ((-1, "left ear"), (1, "right ear")):
    x = side * EAR_X
    z = surface_z(body, x, EAR_Y)                  # the soft top is lower toward the edges: read it, do not guess
    body = try_join(body, ear(**EAR, at=(x, EAR_Y, z), tilt=(0, side * EAR_TILT, 0), sink=5.0), name, added, skipped)
for side, name in ((-1, "left paw"), (1, "right paw")):
    # Read where the front is at the paw's spot: a soft body curves back near its edges.
    x = side * PAW_X
    y = surface_y_front(body, x, PAW["height"] * 0.5) - PAW["depth"] / 2 + PAW_SINK
    body = try_join(body, paw(**PAW, at=(x, y, 0)), name, added, skipped)

# The back is cut flat, moving forward until the plate is broad enough for the rear cover; the rim around it stays soft.
body, back_y = broad_flat_back(flat_sole(body), share=0.65)
print("added:", added, "skipped:", skipped, "size:", size(body), "back cut at y =", round(back_y, 1),
      "round", round(ROUND, 1))
print(feature_report())
