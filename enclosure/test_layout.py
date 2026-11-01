"""Tests for the base design and wire layout checks, on plain shapes with no AI. Run: .venv/Scripts/python -W ignore -m unittest test_layout"""
import unittest

import numpy as np
import trimesh

from case_checks import allow_glue, back_flat_share, check_assembly, check_flat_on_bed, check_screw_spread
from severity import is_warning
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


def rounded_plate():
    """A plate whose whole back is curved, like a cover cut from a fully rounded body."""
    return trimesh.creation.icosphere(subdivisions=4, radius=1.0).apply_scale((50, 5, 25))


class FlatOnBed(unittest.TestCase):
    def part(self, mesh, name="PRINT_Base"):
        return [r for r in check_flat_on_bed({name: mesh}) if r["part"] == name][0]

    def test_a_flat_cover_passes(self):
        found = self.part(trimesh.creation.box(extents=(100, 10, 50)))
        self.assertTrue(found["ok"])

    def test_a_curved_cover_fails_and_is_a_must_pass(self):
        found = self.part(rounded_plate())
        self.assertFalse(found["ok"])
        self.assertFalse(is_warning(found))
        self.assertIn("flat", found["fix"])

    def test_a_cover_flat_only_in_the_middle_fails(self):
        plate = trimesh.creation.box(extents=(100, 4, 50), transform=trimesh.transformations.translation_matrix((0, 2, 0)))
        middle = trimesh.creation.box(extents=(70, 2, 30), transform=trimesh.transformations.translation_matrix((0, 4.5, 0)))
        hollow = trimesh.creation.box(extents=(96, 4, 46), transform=trimesh.transformations.translation_matrix((0, 1, 0)))
        cover = trimesh.boolean.difference([trimesh.boolean.union([plate, middle], engine="manifold"), hollow], engine="manifold")
        self.assertFalse(self.part(cover)["ok"])

    def test_a_flat_narrow_edge_does_not_count(self):
        slab = trimesh.creation.icosphere(subdivisions=4, radius=1.0).apply_scale((50, 6, 25))
        edge_cut = trimesh.creation.box(extents=(4, 40, 80), transform=trimesh.transformations.translation_matrix((49.5, 0, 0)))
        trimmed = trimesh.boolean.difference([slab, edge_cut], engine="manifold")
        self.assertFalse(self.part(trimmed)["ok"])

    def test_a_frame_shaped_holder_can_pass_with_less_contact(self):
        outer = trimesh.creation.box(extents=(30, 4, 30))
        inner = trimesh.creation.box(extents=(20, 6, 20))
        found = self.part(trimesh.boolean.difference([outer, inner], engine="manifold"), "PRINT_Carrier")
        self.assertTrue(found["ok"])

    def test_the_body_stage_refuses_a_curved_back_before_any_engineering(self):
        self.assertLess(back_flat_share(rounded_plate(), "-y"), 0.5)
        self.assertGreater(back_flat_share(trimesh.creation.box(extents=(100, 10, 50)), "-y"), 0.99)


class MoRules(unittest.TestCase):
    def test_a_gap_under_the_tolerance_is_a_must_pass(self):
        self.assertFalse(is_warning({"check": "clearance", "measured": 0.04, "where": "at [0, 0, 0]"}))
        self.assertFalse(is_warning({"check": "parts_gap", "measured": 0.04, "where": "closest at [0, 0, 0], overlap 0.000 mm3"}))

    def retained(self, travels):
        names = ("+x", "-x", "+y", "-y", "+z", "-z")
        return [{"check": "retained", "part": "PURCHASE_Board", "ok": t <= 0.5, "measured": t, "limit": f"toward {n}", "fix": "Add a stop."} for n, t in zip(names, travels)]

    def test_a_glued_board_with_a_face_to_glue_to_is_a_warning(self):
        results = allow_glue(self.retained([0.2, 0.2, 7.0, 0.2, 0.2, 0.2]), {"PURCHASE_Board"})
        loose = [r for r in results if not r["ok"]]
        self.assertTrue(is_warning(loose[0]))
        self.assertIn("Glue PURCHASE_Board", loose[0]["fix"])

    def test_glue_needs_a_face_within_the_limit(self):
        results = allow_glue(self.retained([3.0] * 6), {"PURCHASE_Board"})
        self.assertFalse(any(is_warning(r) for r in results if not r["ok"]))

    def test_a_part_not_marked_as_glued_still_fails(self):
        results = allow_glue(self.retained([0.2, 0.2, 7.0, 0.2, 0.2, 0.2]), set())
        self.assertFalse(any(is_warning(r) for r in results if not r["ok"]))


class AssemblyPath(unittest.TestCase):
    def test_the_error_names_both_things_that_collide(self):
        carrier_rail = trimesh.creation.box(extents=(10, 1, 10), transform=trimesh.transformations.translation_matrix((0, 0.5, 0)))
        shell_post = trimesh.creation.box(extents=(10, 2, 10), transform=trimesh.transformations.translation_matrix((0, 7, 0)))
        steps = [{"add": "PRINT_Carrier"}, {"add": "PRINT_Shell", "from": "-y"}]
        found = check_assembly(steps, {"PRINT_Carrier": carrier_rail, "PRINT_Shell": shell_post}, {}, {})[0]
        self.assertFalse(found["ok"])
        self.assertAlmostEqual(found["measured"], 5, places=2)
        self.assertAlmostEqual(found["moving_at"][1], 6, places=2)
        self.assertAlmostEqual(found["blocker_at"][1], 1, places=2)
        self.assertIn("PRINT_Shell at", found["fix"])
        self.assertIn("PRINT_Carrier at", found["fix"])


class ScrewSpread(unittest.TestCase):
    def failed(self, heads):
        cover = trimesh.creation.box(extents=(80, 10, 40), transform=trimesh.transformations.translation_matrix((0, 20, 20)))
        screws = [{"head_at": h, "drive_from": "+y", "through": "PRINT_Base", "into": "PRINT_Shell"} for h in heads]
        return [r["part"] for r in check_screw_spread(screws, {"PRINT_Base": cover}) if not r["ok"]]

    def test_screws_at_the_corners_pass(self):
        self.assertEqual(self.failed([[-30, 25, 5], [30, 25, 5], [-30, 25, 35], [30, 25, 35]]), [])

    def test_two_screws_on_one_side_fail(self):
        self.assertEqual(self.failed([[32, 25, 5], [32, 25, 30]]), ["along x"])

    def test_two_screws_along_the_bottom_fail(self):
        self.assertEqual(self.failed([[-30, 25, 4], [30, 25, 4]]), ["along z"])


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
