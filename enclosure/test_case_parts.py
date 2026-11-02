"""Tests for the parts library. Most use made-up sizes, so nothing depends on one catalog part. One runs the worked example through the real checks. No AI. Run: .venv/Scripts/python -W ignore -m unittest test_case_parts"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from unittest import mock

import numpy as np
import trimesh
from build123d import Box, Pos, export_stl, export_step

import case_parts as c
import checks
from access import access_list, check_access
from card import build_card
from case_checks import glueable
from part_data import build_data, required_space, space_conflict, write_data

HERE = Path(__file__).resolve().parent


def fake_data():
    """A made-up board: 40 x 20 mm, 2 mm thick, with a component on its back, pins behind it and a socket at one end."""
    features = {
        "pcb": {"min": [-20, -10, -1], "max": [20, 10, 1]},
        "glass": {"min": [-15, -8, 1], "max": [15, 8, 1.5]},
        "usb": {"min": [-21, -4, 1], "max": [-14, 4, 4], "connector": "usb-c", "opens_toward": "-x", "mouth": -21},
    }
    solids = [[[-20, -10, -1], [20, 10, 1]], [[-15, -8, 1], [15, 8, 1.5]], [[-21, -4, 1], [-14, 4, 4]], [[-10, -5, -8], [-8, 5, -1]], [[8, -5, -6], [10, 5, -1]]]
    return {"parts": {"PURCHASE_Board": {"part_id": "made-up", "role": "controller", "front": "+z", "features": features, "solids": solids, "buttons": []}}, "wires": [], "plug_room": {"usb-c": {"width": 12.5, "height": 7.5, "length": 30.0}}}


def placed(at=(0, 0, 20)):
    return c.Part(fake_data(), "PURCHASE_Board", faces="-y", up="+z", local_up="+y", at=at, anchor="pcb")


class Placement(unittest.TestCase):
    def test_a_part_turns_without_changing_size(self):
        low, high = placed().feature("pcb")
        self.assertAlmostEqual(high[0] - low[0], 40)
        self.assertAlmostEqual(high[1] - low[1], 2)
        self.assertAlmostEqual(high[2] - low[2], 20)

    def test_the_matrix_has_no_scale(self):
        matrix = placed().matrix
        for row in matrix[:3]:
            self.assertAlmostEqual(sum(v * v for v in row[:3]), 1)

    def test_the_anchor_lands_where_asked(self):
        low, high = placed((5, 6, 7)).feature("pcb")
        self.assertAlmostEqual((low[0] + high[0]) / 2, 5)
        self.assertAlmostEqual((low[1] + high[1]) / 2, 6)
        self.assertAlmostEqual((low[2] + high[2]) / 2, 7)


class PocketPath(unittest.TestCase):
    def area_at(self, shape, y):
        cut = shape & c.block([-100, y, -100], [100, y + 0.01, 100])
        return cut.volume / 0.01 if cut.solids() else 0

    def test_a_pocket_never_narrows_toward_the_back(self):
        shape = c.pocket(placed(), 40)
        areas = [self.area_at(shape, y) for y in (-1.3, -0.5, 0.5, 2, 5, 10, 30)]
        for earlier, later in zip(areas, areas[1:]):
            self.assertLessEqual(earlier, later + 0.01)

    def test_a_pocket_keeps_the_gap(self):
        box = c.pocket(placed(), 40).bounding_box()
        self.assertAlmostEqual(box.min.X, -21 - c.GAP, places=2)
        self.assertAlmostEqual(box.max.X, 20 + c.GAP, places=2)


class Limits(unittest.TestCase):
    def test_a_long_stop_thickens_by_itself(self):
        part = placed()
        short = c.stop(part, 0, 20, 12, width=4).bounding_box()
        long = c.stop(part, 0, 20, 70, width=4).bounding_box()
        self.assertGreater(long.size.X, short.size.X)

    def test_no_stop_is_too_slender(self):
        for cover_y in (10, 30, 60):
            tip_box = c.stop(placed(), 0, 20, cover_y).bounding_box()
            self.assertLessEqual(tip_box.size.Y / tip_box.size.X, c.MAX_STOP_SLENDERNESS)

    def test_a_stop_running_through_another_part_is_refused(self):
        with self.assertRaisesRegex(AssertionError, "run through"):
            c.stop(placed(), 0, 20, 30, clear_of=[placed((0, 0, 22))])

    def test_a_stop_past_the_outline_is_refused(self):
        with self.assertRaisesRegex(AssertionError, "sticks out"):
            c.stop(placed(), 19, 20, 30)

    def test_a_screw_post_in_a_parts_path_is_refused(self):
        with self.assertRaisesRegex(AssertionError, "block"):
            c.Screw(0, 20, 30, 27, parts=[placed()])

    def test_a_screw_post_clear_of_a_part_is_allowed(self):
        c.Screw(40, 20, 30, 27, parts=[placed()])

    def test_a_screw_reaches_grip_and_keeps_its_lengths(self):
        screw = c.Screw(40, 20, 30, 27)
        self.assertAlmostEqual(screw.head_y, 27 + c.SEAM_GAP + c.HEAD_SEAT)
        self.assertLess(screw.post_front, screw.head_y - c.SCREW_CLEAR_LENGTH - c.SCREW_GRIP_LENGTH)
        self.assertEqual(screw.entry()["drive_from"], "+y")


class Openings(unittest.TestCase):
    def test_a_window_is_only_around_the_glass(self):
        box = c.window(placed(), gap=0.2).bounding_box()
        self.assertAlmostEqual(box.size.X, 30.4, places=2)
        self.assertAlmostEqual(box.size.Z, 16.4, places=2)

    def test_a_usb_opening_has_the_plug_room_size(self):
        box = c.usb_opening(placed(), fake_data()).bounding_box()
        self.assertAlmostEqual(box.size.X, 30.2, places=2)
        self.assertAlmostEqual(box.min.X, -51, places=2)


class Space(unittest.TestCase):
    def test_more_parts_need_more_width(self):
        one = required_space(["ssd1309-242-oled"])
        two = required_space(["seeed-xiao-esp32s3", "ssd1309-242-oled", "ky-040-rotary-encoder"])
        self.assertGreater(two["width"], one["width"])

    def test_the_space_holds_the_screen_board(self):
        space = required_space(["seeed-xiao-esp32s3", "ssd1309-242-oled", "ky-040-rotary-encoder"])
        self.assertGreater(space["width"], 71 + 18)

    def test_the_space_holds_a_long_controller(self):
        space = required_space(["esp32-s3-devkit-n16r8", "tft-154-lcd-display-module", "ky-040-rotary-encoder"])
        self.assertGreater(space["width"], 60)
        self.assertGreater(space["height"], 43.5)


class HolderOnEveryBoard(unittest.TestCase):
    """The holder must fit every controller we have, including what sticks out past its edges. Run on real models, so a new board is tested automatically."""

    def controllers(self):
        found = []
        for path in sorted((HERE / "cards").glob("*.json")):
            card = json.loads(path.read_text(encoding="utf-8"))
            if card.get("role") == "controller" and "sideways" not in card["part_id"] and "pcb" in card["features"]:
                found.append(card["part_id"])
        return found

    def test_the_board_goes_into_its_holder(self):
        self.assertGreaterEqual(len(self.controllers()), 5)
        for part_id in self.controllers():
            with self.subTest(part_id):
                data = {"parts": {"PURCHASE_Board": build_data([part_id])["parts"]["PURCHASE_Board"]}, "wires": [], "plug_room": {}}
                card = build_card(part_id)
                axes = [a for a in ("+x", "+y", "+z", "-x", "-y", "-z") if a[1] != card["front"][1]]
                part = c.Part(data, "PURCHASE_Board", faces="+y", up="+z", local_up=axes[0], at=(0, 0, 40), anchor="pcb")
                behind = max(b[1][1] for b in part.solids())
                shape = c.tower(part, behind + 1.0)
                with tempfile.TemporaryDirectory() as temp:
                    path = Path(temp) / "holder.stl"
                    export_stl(c.one_solid(shape, "holder") if len(shape.solids()) == 1 else shape, str(path), tolerance=0.05)
                    holder = trimesh.load_mesh(path)
                matrix = np.array(part.matrix, dtype=float)
                gap, inside, where = checks.clearance(holder, part_id, matrix)
                self.assertEqual(inside, 0, f"{inside} points of {part_id} are inside the holder near {where}")
                self.assertGreaterEqual(gap, checks.MIN_GAP - checks.GAP_TOLERANCE)
                world = checks.apply(matrix, checks.part_surface(part_id)[2])
                distance, _ = checks.travel(holder, world, np.array([0, -1.0, 0]))
                self.assertTrue(np.isinf(distance), f"{part_id} hits its holder after {distance} mm on the way in")


class FreeSpots(unittest.TestCase):
    def test_spots_stay_clear_of_a_part(self):
        part = placed()
        spots = c.free_spots([part], -40, 40, 0, 40, reach=c.POST_RADIUS)
        self.assertTrue(spots)
        x0, x1, z0, z1 = c.outline(part)
        for x, z in spots:
            self.assertFalse(x0 - c.POST_RADIUS < x < x1 + c.POST_RADIUS and z0 - c.POST_RADIUS < z < z1 + c.POST_RADIUS)

    def test_a_listed_spot_is_accepted_by_the_screw(self):
        part = placed()
        x, z = c.free_spots([part], -40, 40, 0, 40, reach=c.POST_RADIUS)[0]
        c.Screw(x, z, 30, 27, parts=[part])


class AccessRules(unittest.TestCase):
    def test_used_things_need_access(self):
        items = {(n, f) for n, f, _ in access_list(["seeed-xiao-esp32s3", "ssd1309-242-oled", "ky-040-rotary-encoder"])}
        self.assertEqual(items, {("PURCHASE_Board", "usb"), ("PURCHASE_Part2", "screen"), ("PURCHASE_Part3", "shaft")})

    def test_a_battery_removes_the_power_opening(self):
        with mock.patch("access.has_battery", return_value=True):
            items = {f for _, f, _ in access_list(["seeed-xiao-esp32s3", "ssd1309-242-oled"])}
        self.assertNotIn("usb", items)

    def test_unused_ports_and_maintenance_buttons_are_left_out(self):
        items = {f for _, f, _ in access_list(["waveshare-esp32-s3-eth-ov5640-camera-board", "ssd1309-242-oled", "ttp223-touch"])}
        self.assertEqual(items, {"usb", "screen", "touch"})

    def test_a_blocked_item_fails_and_a_clear_one_passes(self):
        card = {"front": "+z", "features": {"screen": {"min": [-5, -5, 0], "max": [5, 5, 0]}}}
        transforms = {"PURCHASE_Part2": np.eye(4)}
        wall = trimesh.creation.box(extents=(30, 30, 2), transform=trimesh.transformations.translation_matrix((0, 0, 5)))
        beside = trimesh.creation.box(extents=(4, 30, 2), transform=trimesh.transformations.translation_matrix((20, 0, 5)))
        with mock.patch("access.access_list", return_value=[("PURCHASE_Part2", "screen", "you look at it")]):
            self.assertFalse(check_access(["a"], {"PRINT_Shell": wall}, {"PURCHASE_Part2": card}, transforms)[0]["ok"])
            self.assertTrue(check_access(["a"], {"PRINT_Shell": beside}, {"PURCHASE_Part2": card}, transforms)[0]["ok"])


class GlueLimits(unittest.TestCase):
    def test_a_part_you_press_cannot_be_glued(self):
        self.assertEqual(glueable({"PURCHASE_Board", "PURCHASE_Part3"}, {"PURCHASE_Board": {"features": {}}, "PURCHASE_Part3": {"features": {"shaft": {}}}}), {"PURCHASE_Board"})


class Conflict(unittest.TestCase):
    LIMITS = {"max_width": 100, "max_height": 60, "tight_width": 90, "tight_height": 50}
    BASE = {"max_depth": 60, "width_to_height": [1.0, 3.0]}

    def test_parts_that_fit_have_no_conflict(self):
        self.assertIsNone(space_conflict(self.BASE, {"width": 80, "height": 40, "depth": 40}, self.LIMITS))

    def test_a_design_too_small_is_flagged_before_any_ai_call(self):
        found = space_conflict(self.BASE, {"width": 120, "height": 40, "depth": 40}, self.LIMITS)
        self.assertIn("120 mm of width", found)

    def test_too_little_depth_is_flagged(self):
        self.assertIn("depth", space_conflict(self.BASE, {"width": 80, "height": 40, "depth": 70}, self.LIMITS))


class WorkedExample(unittest.TestCase):
    def test_the_example_in_the_brief_passes_the_real_checks(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            body = Pos(0, -5, 27) * Box(108, 50, 54)
            export_step(body, str(folder / "BODY.step"))
            export_stl(body, str(folder / "BODY.stl"), tolerance=0.01)
            shutil.copy(HERE / "case_example.py", folder / "design.py")
            shutil.copy(HERE / "case_parts.py", folder / "case_parts.py")
            write_data(["seeed-xiao-esp32s3", "ssd1309-242-oled", "ky-040-rotary-encoder"], folder)
            done = subprocess.run([sys.executable, "-E", "-s", "design.py"], cwd=folder, capture_output=True, text=True, timeout=300)
            self.assertEqual(done.returncode, 0, done.stderr[-1500:])
            report = checks.check_design(folder, "case")
            self.assertTrue(report["passed"], json.dumps([[r["check"], r["part"], r["measured"]] for r in report["failed"]], default=str))


if __name__ == "__main__":
    unittest.main()
