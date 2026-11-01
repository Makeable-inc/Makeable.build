"""Break tests for the C6 + KY-040 knob, on a plain hand-made box. Run: .venv/Scripts/python -W ignore -m unittest test_knob"""
import unittest

import numpy as np
import trimesh

import wiring_checks as w
from card import build_card
from case_checks import cylinder, merged

C6 = "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header"
KY = "ky-040-rotary-encoder"
# Shaft pointing up, with the knob's base just above a 2 mm top wall whose outside is at z = 50.
KNOB_LEVEL = 33.1
UP = np.array([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, KNOB_LEVEL], [0, 0, 0, 1.0]])
SHAFT = (-1.3, 0.0)


def box(low, high):
    low, high = np.array(low, dtype=float), np.array(high, dtype=float)
    return trimesh.creation.box(extents=high - low, transform=trimesh.transformations.translation_matrix((low + high) / 2))


def case(hole_radius=5.2, floor_top=None):
    outer = trimesh.creation.box(extents=(100, 100, 100))
    inner = trimesh.creation.box(extents=(96, 96, 96))
    shell = trimesh.boolean.difference([outer, inner], engine="manifold")
    if hole_radius is None:
        return shell
    return trimesh.boolean.difference([shell, cylinder(hole_radius, (SHAFT[0], SHAFT[1], 40), (0, 0, 1), 20)], engine="manifold")


def stops(gap=0.2):
    top = KNOB_LEVEL - 0.8 - gap
    return [box((-12.5, -8.5, top - 5), (-9.0, 8.5, top)), box((4.0, -8.5, top - 5), (10.0, 8.5, top))]


class Knob(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.card = build_card(KY)
        cls.c6 = build_card(C6)

    def run_knob(self, meshes=None, transform=UP, others=None, paths=(), screen=None):
        meshes = {"PRINT_Shell": case(), "PRINT_A": stops()[0], "PRINT_B": stops()[1]} if meshes is None else meshes
        results = w.check_knob("PURCHASE_Knob", self.card, transform, meshes, merged(meshes.values()), others or {}, list(paths), screen)
        return {r["check"]: r for r in results}

    def failed(self, results):
        return {k for k, r in results.items() if not r["ok"]}

    def test_compiler_gives_five_wires_with_no_shared_pin(self):
        wires = w.wires_for([C6, KY])
        self.assertEqual(len(wires), 5)
        self.assertEqual(len({str(x["from"]["position"]) for x in wires}), 5)

    def test_pins_stay_as_in_the_model_not_the_compiler(self):
        wire = w.wires_for([C6, KY])[0]
        self.assertEqual(wire["to"]["normal"], [1, 0, 0])
        plug = w.plug_local(wire["to"])
        self.assertEqual(plug["normal"].tolist(), [0, 0, 1])
        self.assertAlmostEqual(plug["back"][2], 18.0, delta=0.05)

    def test_every_wire_gets_its_own_colour(self):
        colours = w.wire_colours(w.wires_for([C6, KY]))
        self.assertEqual(len(set(str(c).lower() for c in colours.values())), 5)
        self.assertEqual(colours["p0:plus"], "red")

    def test_c6_side_buttons_are_on_the_card(self):
        self.assertEqual([b["press_from"] for b in self.c6["buttons"]], ["-x", "+x"])

    def test_good_knob_passes(self):
        results = self.run_knob()
        self.assertEqual(self.failed(results), set(), {k: r for k, r in results.items() if not r["ok"]})

    def test_no_wall_around_the_shaft(self):
        results = self.run_knob({"PRINT_Shell": case(hole_radius=12.0), "PRINT_A": stops()[0], "PRINT_B": stops()[1]})
        self.assertIn("shaft_hole", self.failed(results))

    def test_shaft_blocked(self):
        results = self.run_knob({"PRINT_Shell": case(hole_radius=None), "PRINT_A": stops()[0], "PRINT_B": stops()[1]})
        self.assertIn("shaft_hole", self.failed(results))

    def test_knob_with_no_finger_room(self):
        collar = trimesh.boolean.difference([box((-15, -15, 50), (13, 15, 60)), cylinder(9.0, (SHAFT[0], SHAFT[1], 45), (0, 0, 1), 20)], engine="manifold")
        results = self.run_knob({"PRINT_Shell": case(), "PRINT_A": stops()[0], "PRINT_B": stops()[1], "PRINT_Collar": collar})
        self.assertEqual(self.failed(results), {"knob_room"})

    def test_another_part_in_the_finger_room(self):
        results = self.run_knob(others={"PURCHASE_Board": np.array([[9.0, 0.0, KNOB_LEVEL + 26.0]])})
        self.assertEqual(self.failed(results), {"knob_room"})

    def test_shaft_on_the_desk_side(self):
        down = np.array([[1, 0, 0, 0], [0, -1, 0, 0], [0, 0, -1, 0], [0, 0, 0, 1.0]])
        self.assertIn("knob_place", self.failed(self.run_knob(transform=down)))

    def test_shaft_behind_the_screen(self):
        self.assertIn("knob_place", self.failed(self.run_knob(screen=np.array([0, 0, -1.0]))))

    def test_nothing_behind_the_board(self):
        self.assertIn("press_stop", self.failed(self.run_knob({"PRINT_Shell": case()})))

    def test_stop_on_one_side_only(self):
        self.assertIn("press_stop", self.failed(self.run_knob({"PRINT_Shell": case(), "PRINT_A": stops()[0]})))

    def test_stops_too_far_behind(self):
        far = stops(gap=1.5)
        self.assertIn("press_stop", self.failed(self.run_knob({"PRINT_Shell": case(), "PRINT_A": far[0], "PRINT_B": far[1]})))

    def test_wire_behind_the_board(self):
        path = [[-20.0, 0.0, KNOB_LEVEL - 2.0], [20.0, 0.0, KNOB_LEVEL - 2.0]]
        self.assertEqual(self.failed(self.run_knob(paths=[path])), {"press_not_on_wire"})

    def run_plugs(self, meshes):
        design = {"wires": []}
        transforms = {"PURCHASE_Board": np.array([[1, 0, 0, -20.0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1.0]]), "PURCHASE_Knob": UP}
        purchased = {"PURCHASE_Board": {"part_id": C6}, "PURCHASE_Knob": {"part_id": KY}}
        cards = {"PURCHASE_Board": self.c6, "PURCHASE_Knob": self.card}
        results = w.check_wiring(design, meshes, purchased, cards, transforms)
        return [r for r in results if r["check"] == "plug_room" and r["part"].startswith("PURCHASE_Knob")]

    def test_flat_wall_blocks_the_plugs(self):
        results = self.run_plugs({"PRINT_Shell": case()})
        self.assertEqual(len(results), 5)
        self.assertTrue(all(not r["ok"] for r in results))

    def test_hump_over_the_pins_clears_the_plugs(self):
        slot = box((10.4, -9, 47), (15.5, 9, 53))
        hump = trimesh.boolean.difference([box((8.4, -11, 50.1), (17.5, 11, 62)), box((10.4, -9, 49), (15.5, 9, 60))], engine="manifold")
        shell = trimesh.boolean.difference([case(), slot], engine="manifold")
        results = self.run_plugs({"PRINT_Shell": shell, "PRINT_Hump": hump})
        self.assertEqual(len(results), 5)
        self.assertTrue(all(r["ok"] for r in results), results)


if __name__ == "__main__":
    unittest.main()
