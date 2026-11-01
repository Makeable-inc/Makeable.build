"""Break tests for wiring, buttons and the touch sensor, on a plain hand-made box. Run: .venv/Scripts/python -W ignore -m unittest test_wiring"""
import json
import unittest

import numpy as np
import trimesh

import wiring_checks as w
from card import CardError, build_card, measure, load_nodes, CARDS
from case_checks import cylinder, merged
from parts import ensure_part

AMOLED = "waveshare-esp32-s3-1-91-amoled-display-board"
TOUCH = "ttp223-touch"
IDENTITY = np.eye(4)
# Sensor's -z side against the -x wall, with its pins pointing +x.
SENSOR = np.array([[0, 0, 1, -46.0], [0, 1, 0, -25.0], [-1, 0, 0, -25.0], [0, 0, 0, 1.0]])


def hollow_box(wall=2.0):
    outer = trimesh.creation.box(extents=(100, 100, 100))
    inner = trimesh.creation.box(extents=(100 - 2 * wall, 100 - 2 * wall, 100 - 2 * wall))
    return trimesh.boolean.difference([outer, inner], engine="manifold")


def button_holes(mesh):
    for x, direction in ((-11.6, (-1, 0, 0)), (11.6, (1, 0, 0))):
        mesh = trimesh.boolean.difference([mesh, cylinder(1.3, (x, 25.1, -6.1), direction, 60)], engine="manifold")
    return mesh


def touch_hole(mesh, radius=5.3, center=(-40.0, -28.7, -25.0)):
    return trimesh.boolean.difference([mesh, cylinder(radius, center, (-1, 0, 0), 30)], engine="manifold")


def good_case():
    return touch_hole(button_holes(hollow_box()))


def touch_hole_down():
    return trimesh.boolean.difference([hollow_box(), cylinder(5.3, (0.0, -3.7, -40.0), (0, 0, -1), 30)], engine="manifold")


class Wiring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards = {"PURCHASE_Board": build_card(AMOLED), "PURCHASE_Touch": build_card(TOUCH)}
        cls.purchased = {"PURCHASE_Board": {"part_id": AMOLED}, "PURCHASE_Touch": {"part_id": TOUCH}}
        cls.transforms = {"PURCHASE_Board": IDENTITY, "PURCHASE_Touch": SENSOR}
        cls.wires = w.wires_for([AMOLED, TOUCH])

    def good_paths(self):
        routes = {}
        for wire in self.wires:
            start = w.plug_local(wire["from"])
            finish = w.plug_local(wire["to"])
            a = start["back"]
            b = w.apply(SENSOR, finish["back"][None])[0]
            low = a + np.array([0, 0, -8.0])
            out = b + np.array([9.0, 0, 0])
            routes[wire["net"]] = np.array([a, low, [low[0], low[1], -37.0], [out[0] + 2, out[1], -37.0], out, b]).tolist()
        return routes

    def run_checks(self, paths=None, meshes=None, transforms=None):
        paths = self.good_paths() if paths is None else paths
        meshes = {"PRINT_Shell": good_case()} if meshes is None else meshes
        design = {"wires": [{"net": n, "path": p} for n, p in paths.items()]}
        return w.check_wiring(design, meshes, self.purchased, self.cards, transforms or self.transforms)

    def failed(self, results):
        return {r["check"] for r in results if not r["ok"]}

    def test_compiler_gives_three_wires(self):
        self.assertEqual(sorted(x["from"]["signal"] for x in self.wires), ["3V3", "GND", "GPIO17"])

    def test_pin_tip_comes_from_the_model(self):
        self.assertAlmostEqual(w.pin_tip(self.wires[0]["from"])[2], -13.0, delta=0.05)
        self.assertAlmostEqual(w.pin_tip(self.wires[0]["to"])[2], 10.8, delta=0.05)

    def test_good_box_passes(self):
        results = self.run_checks()
        self.assertEqual(self.failed(results), set(), json.dumps([r for r in results if not r["ok"]], indent=1, default=str)[:1500])

    def test_missing_wire(self):
        paths = self.good_paths()
        paths.pop(next(iter(paths)))
        self.assertEqual(self.failed(self.run_checks(paths)), {"wire_route"})

    def test_route_that_stops_short(self):
        paths = self.good_paths()
        net = next(iter(paths))
        paths[net] = paths[net][:-1]
        self.assertIn("wire_reach", self.failed(self.run_checks(paths)))

    def test_sharp_corner_right_at_the_plug(self):
        paths = self.good_paths()
        net = next(iter(paths))
        a = np.array(paths[net][0])
        paths[net][1] = (a + np.array([1.0, 0, 0])).tolist()
        self.assertIn("wire_bend", self.failed(self.run_checks(paths)))

    def test_route_through_plastic(self):
        block2 = trimesh.creation.box(extents=(60, 90, 6), transform=trimesh.transformations.translation_matrix((-5, 0, -37)))
        meshes = {"PRINT_Shell": good_case(), "PRINT_Block": block2}
        self.assertIn("wire_clear_plastic", self.failed(self.run_checks(meshes=meshes)))

    def test_route_through_the_board(self):
        paths = self.good_paths()
        net = next(iter(paths))
        paths[net][2] = [0.0, 0.0, -3.0]
        self.assertIn("wire_clear_parts", self.failed(self.run_checks(paths)))

    def test_route_out_of_the_case(self):
        paths = self.good_paths()
        net = next(iter(paths))
        paths[net][2] = [0.0, 80.0, -37.0]
        self.assertIn("wire_inside", self.failed(self.run_checks(paths)))

    def test_route_through_the_usb_path(self):
        paths = self.good_paths()
        net = next(iter(paths))
        paths[net][2] = [0.0, 40.0, -6.0]
        self.assertIn("wire_clear_usb", self.failed(self.run_checks(paths)))

    def test_plastic_in_a_plugs_way(self):
        plug = w.plug_local(self.wires[0]["from"])
        block = trimesh.creation.box(extents=(6, 6, 4), transform=trimesh.transformations.translation_matrix(plug["back"] + np.array([0, 0, 3.0])))
        meshes = {"PRINT_Shell": good_case(), "PRINT_Block": block}
        self.assertIn("plug_room", self.failed(self.run_checks(meshes=meshes)))

    def test_button_with_no_hole(self):
        self.assertEqual(self.failed(self.run_checks(meshes={"PRINT_Shell": touch_hole(hollow_box())})), {"button_reach"})

    def test_no_opening_over_the_sensor(self):
        self.assertIn("touch_opening", self.failed(self.run_checks(meshes={"PRINT_Shell": button_holes(hollow_box())})))

    def test_opening_too_small(self):
        mesh = touch_hole(button_holes(hollow_box()), radius=3.0)
        self.assertIn("touch_opening", self.failed(self.run_checks(meshes={"PRINT_Shell": mesh})))

    def test_opening_off_the_touch_area(self):
        mesh = touch_hole(button_holes(hollow_box()), center=(-40.0, -22.0, -25.0))
        self.assertIn("touch_opening", self.failed(self.run_checks(meshes={"PRINT_Shell": mesh})))

    def test_opening_bigger_than_the_sensor(self):
        mesh = touch_hole(button_holes(hollow_box()), radius=20.0)
        self.assertIn("touch_rim", self.failed(self.run_checks(meshes={"PRINT_Shell": mesh})))

    def test_opening_too_deep(self):
        moved = SENSOR.copy()
        moved[0, 3] = -40.0
        self.assertIn("touch_depth", self.failed(self.run_checks(transforms={"PURCHASE_Board": IDENTITY, "PURCHASE_Touch": moved})))

    def test_part_in_front_of_the_opening(self):
        case = good_case()
        blocker = np.array([[-47.5, -28.7, -25.0]])
        results = w.check_touch("PURCHASE_Touch", self.cards["PURCHASE_Touch"], SENSOR, {"PRINT_Shell": case}, merged([case]), {"PURCHASE_Board": blocker}, None)
        self.assertFalse(next(r for r in results if r["check"] == "touch_opening")["ok"])

    def touch_place(self, transform, screen_normal):
        case = good_case()
        results = w.check_touch("PURCHASE_Touch", self.cards["PURCHASE_Touch"], transform, {"PRINT_Shell": case}, merged([case]), {}, screen_normal)
        return next(r for r in results if r["check"] == "touch_place")["ok"]

    def test_opening_on_the_desk_side(self):
        # With +z up, the sensor's -z side faces the desk and +z faces the wall above the far side, so make both sides point down-ish by testing a tilt: the check picks the better side, then rejects it if it faces the desk.
        down = np.array([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, -47.2], [0, 0, 0, 1.0]])
        bottom = touch_hole_down()
        results = w.check_touch("PURCHASE_Touch", self.cards["PURCHASE_Touch"], down, {"PRINT_Shell": bottom}, merged([bottom]), {}, None)
        self.assertFalse(next(r for r in results if r["check"] == "touch_place")["ok"])

    def test_opening_behind_the_screen(self):
        self.assertFalse(self.touch_place(SENSOR, np.array([1.0, 0, 0])))
        self.assertTrue(self.touch_place(SENSOR, np.array([-1.0, 0, 0])))

    def test_pins_pointing_out_of_the_case(self):
        flipped = np.array([[0, 0, -1, -34.0], [0, 1, 0, -25.0], [1, 0, 0, -25.0], [0, 0, 0, 1.0]])
        results = self.run_checks(transforms={"PURCHASE_Board": IDENTITY, "PURCHASE_Touch": flipped})
        self.assertIn("plug_inside", self.failed(results))

    def test_estimated_box_must_say_so(self):
        spec = json.loads((CARDS / f"{AMOLED}.json").read_text(encoding="utf-8"))
        del spec["features"]["screen"]["estimate"]
        with self.assertRaisesRegex(CardError, "estimate"):
            measure(spec, load_nodes(ensure_part(AMOLED)))


if __name__ == "__main__":
    unittest.main()
