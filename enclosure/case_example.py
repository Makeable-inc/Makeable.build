"""A complete case built only from case_parts, for a controller, a separate screen and a knob. It is sent to the AI as a worked example, and a test runs it through the real checks."""
from build123d import import_step
from case_parts import *

data = load_data()
body = one_solid(import_step("BODY.step"), "body")
box = body.bounding_box()
front_y, back_y = box.min.Y, box.max.Y
seam_y = back_y - COVER_THICKNESS - SEAM_GAP

# Where the parts go is the design decision. Change these first.
screen_front = deepest_front(body, -44.0, 16.0, 8.0, 46.0) + MIN_WALL
screen = Part(data, "PURCHASE_Part2", faces="-y", up="+z", local_up="+y", at=(-14.0, screen_front, 27.0), anchor="glass")
knob = Part(data, "PURCHASE_Part3", faces="-y", up="+z", local_up="+y", at=(35.0, front_y + 13.0, 27.0), anchor="bushing")
controller = Part(data, "PURCHASE_Board", faces="+y", up="-z", local_up="+z", at=(-34.0, seam_y - 9.0, 20.0), anchor="pcb")

shell, cover = split(body, seam_y)
usb = usb_opening(controller, data)
wire_room = block([knob.feature("pcb")[0][0], knob.feature("pcb")[1][1] + 1.0, 4.0], [50.5, seam_y + 1, 50.0])
cuts = [pocket(screen, seam_y + 1, data), pocket(knob, seam_y + 1, data), pocket(controller, seam_y + 1, data), tower_room(controller, seam_y + 1), wire_room,
        window(screen), shaft_hole(knob), knob_recess(knob, knob.feature("bushing")[0][1] + 1.0), usb]
shell = one_solid(shell - joined(cuts), "hollow shell")

# Screws and stops go on spots that fit, found by the library and spread to the corners: never typed in by hand.
screws = place_screws([screen, knob], -50, 50, 3, 51, back_y, seam_y, towers=[controller], body=body, count=3)
print("screws at", [(s.x, s.z) for s in screws])
shell = one_solid(shell + (joined([s.post() for s in screws]) & body), "shell with posts")
shell = one_solid(shell - joined([s.shell_cut() for s in screws]) - usb, "drilled shell")

inner = back_y - COVER_THICKNESS + 0.5
extras = [tower(controller, inner)] + place_stops(screen, inner, clear_of=[controller], count=2) + place_stops(knob, inner, count=1)
cover = one_solid(cover + joined(extras), "cover with tower and stops")
cover = one_solid(cover - joined([s.cover_cut() for s in screws]) - usb, "PRINT_Base")

wires = wire_paths(data, [screen, knob, controller], seam_y - 6.0)
finish(shell, cover, [screen, knob], controller, screws, wires, glued=[controller.name])
