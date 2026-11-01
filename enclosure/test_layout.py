"""Tests for the base design and wire layout checks, on plain shapes with no AI. Run: .venv/Scripts/python -W ignore -m unittest test_layout"""
import unittest

import numpy as np
import trimesh

from layout_checks import check_base_design, check_wire_crossing, check_wire_hidden
from space_checks import case_openness, points_seeing_out

BOX = {"min": [-1, -1, -1], "max": [1, 1, 1], "size": [2, 2, 2]}
USB = {**BOX, "opens_toward": "-y"}
CARDS = {"PURCHASE_Board": {"front": "+z", "features": {"screen": BOX, "usb": USB}}}
# Turns the part's +z to world -y, and its -y to world -x.
TURN = np.array([[0, 1, 0, -20], [0, 0, -1, 0], [-1, 0, 0, 0], [0, 0, 0, 1]], dtype=float)
BASE = {"front": "-y", "width_to_height": [1.5, 2.6], "max_depth": 30, "usb_side": "-x", "place": {"PURCHASE_Board": {"feature": "screen", "across": [0.1, 0.4]}}}


def hollow_box(hole=False):
    box = trimesh.creation.box(extents=(80, 20, 40)).difference(trimesh.creation.box(extents=(70, 14, 30)), engine="manifold")
    if hole:
        box = box.difference(trimesh.creation.box(extents=(10, 10, 10), transform=trimesh.transformations.translation_matrix((0, 0, 18))), engine="manifold")
    return box


class Wires(unittest.TestCase):
    def test_side_by_side_wires_pass(self):
        design = {"wires": [{"net": "a", "path": [[0, 0, 0], [10, 0, 0]]}, {"net": "b", "path": [[0, 2, 0], [10, 2, 0]]}]}
        self.assertTrue(all(r["ok"] for r in check_wire_crossing(design)))

    def test_crossing_wires_fail_with_a_place(self):
        design = {"wires": [{"net": "a", "path": [[0, 0, 0], [10, 0, 0]]}, {"net": "b", "path": [[5, -5, 0], [5, 5, 0]]}]}
        failure = check_wire_crossing(design)[0]
        self.assertFalse(failure["ok"])
        self.assertAlmostEqual(failure["where"][0], 5, delta=1)

    def test_wire_inside_closed_case_is_hidden(self):
        design = {"wires": [{"net": "a", "path": [[-5, 0, 0], [5, 0, 0]]}]}
        self.assertTrue(check_wire_hidden(design, hollow_box())[0]["ok"])

    def test_wire_under_an_opening_fails(self):
        design = {"wires": [{"net": "a", "path": [[-5, 0, 0], [5, 0, 0]]}]}
        self.assertFalse(check_wire_hidden(design, hollow_box(hole=True))[0]["ok"])


class Openings(unittest.TestCase):
    INSIDE = np.array([[0.0, 0.0, 0.0]])

    def plug_room(self):
        return trimesh.creation.box(extents=(12, 12, 30), transform=trimesh.transformations.translation_matrix((0, 0, 25)))

    def test_closed_case_has_no_open_route(self):
        self.assertIsNone(case_openness(hollow_box(), [], self.INSIDE))

    def test_thin_seam_is_not_an_opening(self):
        top = trimesh.creation.box(extents=(90, 30, 50), transform=trimesh.transformations.translation_matrix((0, 0, 25.15)))
        split = trimesh.util.concatenate([hollow_box().intersection(top, engine="manifold"), hollow_box().difference(trimesh.creation.box(extents=(90, 30, 50), transform=trimesh.transformations.translation_matrix((0, 0, 25))), engine="manifold")])
        self.assertIsNone(case_openness(split, [], self.INSIDE))

    def test_oversized_hole_fails_and_points_at_it(self):
        path = case_openness(hollow_box(hole=True), [], self.INSIDE)
        self.assertIsNotNone(path)
        self.assertGreater(path[-1][2], 15)

    def test_hole_inside_its_allowed_size_passes(self):
        self.assertIsNone(case_openness(hollow_box(hole=True), [self.plug_room()], self.INSIDE))

    def test_hole_bigger_than_its_allowed_size_fails(self):
        small = trimesh.creation.box(extents=(4, 4, 40), transform=trimesh.transformations.translation_matrix((0, 0, 30)))
        self.assertIsNotNone(case_openness(hollow_box(hole=True), [small], self.INSIDE))

    def test_point_under_a_hole_sees_out(self):
        self.assertTrue(points_seeing_out(self.INSIDE, hollow_box(hole=True))[0])

    def test_point_in_a_closed_case_does_not(self):
        self.assertFalse(points_seeing_out(self.INSIDE, hollow_box())[0])


class Layout(unittest.TestCase):
    def failed(self, base=BASE, transform=TURN):
        return {r["check"] for r in check_base_design(base, CARDS, {"PURCHASE_Board": transform}, hollow_box()) if not r["ok"]}

    def test_matching_case_passes(self):
        self.assertEqual(self.failed(), set())

    def test_screen_in_the_wrong_place_fails(self):
        moved = TURN.copy()
        moved[0, 3] = 25
        self.assertEqual(self.failed(transform=moved), {"base_place"})

    def test_wrong_proportions_fail(self):
        self.assertEqual(self.failed(base={**BASE, "width_to_height": [1.0, 1.2]}), {"base_proportion"})

    def test_too_deep_fails(self):
        self.assertEqual(self.failed(base={**BASE, "max_depth": 10}), {"base_depth"})

    def test_screen_facing_the_wrong_way_fails(self):
        flat = np.eye(4)
        flat[0, 3] = -20
        self.assertIn("base_facing", self.failed(transform=flat))

    def test_usb_on_the_wrong_side_fails(self):
        self.assertEqual(self.failed(base={**BASE, "usb_side": "+x"}), {"base_usb"})


if __name__ == "__main__":
    unittest.main()
