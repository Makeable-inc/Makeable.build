"""Break tests: a good Carrier must pass, and each deliberately bad one must fail the right check. Run: .venv/Scripts/python -W ignore -m unittest test_checks"""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import trimesh
from build123d import Box, Pos, Rot

from checks import check_design
from fixtures import C6, IDENTITY, make_carrier, write_design

QUARTER_TURN = [[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
SCALED = [[1.02, 0, 0, 0], [0, 1.02, 0, 0], [0, 0, 1.02, 0], [0, 0, 0, 1]]
MOVED = [[1, 0, 0, 3], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


class Checks(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name) / "design"

    def assert_fails_only(self, expected):
        report = check_design(self.folder)
        failed = {r["check"] for r in report["failed"]}
        self.assertFalse(report["passed"])
        self.assertEqual(failed, set(expected), json.dumps(report["failed"], indent=1, default=str))
        for failure in report["failed"]:
            self.assertTrue(failure["fix"], failure)

    def test_good_carrier_passes(self):
        write_design(self.folder)
        report = check_design(self.folder)
        self.assertTrue(report["passed"], json.dumps(report["failed"], indent=1, default=str))

    def test_good_carrier_turned_with_the_board_passes(self):
        write_design(self.folder, shape=Rot(Z=90) * make_carrier(), transform=QUARTER_TURN)
        report = check_design(self.folder)
        self.assertTrue(report["passed"], json.dumps(report["failed"], indent=1, default=str))

    def test_pocket_too_tight(self):
        write_design(self.folder, side_gap=0.02)
        self.assert_fails_only(["clearance"])

    def test_pocket_too_loose(self):
        # Narrow ledges, so only the outer wall could stop the board. With the usual ledges the parts behind the board stop it first.
        write_design(self.folder, side_gap=1.0, ledge_inner=11.7, button_notch=False)
        self.assert_fails_only(["held"])

    def test_ledge_too_far_below_the_board(self):
        write_design(self.folder, ledge_gap=1.0)
        self.assert_fails_only(["held"])

    def test_ledge_hits_the_side_parts(self):
        write_design(self.folder, button_notch=False)
        self.assert_fails_only(["clearance", "insertable"])

    def test_slot_clears_the_socket_but_not_the_plug(self):
        write_design(self.folder, usb_slot=10.0)
        self.assert_fails_only(["usb_access"])

    def test_wall_cuts_into_the_usb_socket(self):
        write_design(self.folder, usb_slot=8.0)
        self.assert_fails_only(["clearance", "insertable", "usb_access"])

    def test_overhang_blocks_the_board_going_in(self):
        write_design(self.folder, lip=True)
        self.assert_fails_only(["insertable"])

    def test_thin_plastic(self):
        write_design(self.folder, wall=0.6, ledge_thickness=0.6)
        self.assert_fails_only(["wall"])

    def test_two_pieces(self):
        write_design(self.folder, extra_piece=True)
        self.assert_fails_only(["one_piece"])

    def test_mesh_with_a_hole(self):
        write_design(self.folder)
        path = self.folder / "PRINT_Carrier.stl"
        mesh = trimesh.load_mesh(path)
        mesh.update_faces(list(range(1, len(mesh.faces))))
        mesh.export(path)
        self.assert_fails_only(["sealed"])

    def test_zero_area_export_triangles_are_not_a_hole(self):
        write_design(self.folder)
        path = self.folder / "PRINT_Carrier.stl"
        mesh = trimesh.load_mesh(path)
        v = mesh.vertices
        extra = trimesh.Trimesh(np.vstack([v, v[0]]), np.vstack([mesh.faces, [[0, len(v), 1]]]), process=False)
        extra.export(path)
        self.assertTrue(check_design(self.folder)["passed"])

    def test_pinched_edge_is_located(self):
        pinched = Pos(0, 0, 5) * Box(10, 10, 10) + Pos(10, 10, 5) * Box(10, 10, 10)
        write_design(self.folder, shape=pinched)
        report = check_design(self.folder)
        failure = next(r for r in report["failed"] if r["check"] == "sealed")
        self.assertIn("1 pinched", failure["measured"])
        self.assertIn("[5.0, 5.0,", failure["where"])
        self.assertIn("no thickness", failure["fix"])

    def test_board_rescaled_to_fit(self):
        write_design(self.folder, transform=SCALED)
        self.assert_fails_only(["not_rescaled"])

    def test_board_moved_out_of_its_pocket(self):
        write_design(self.folder, transform=MOVED)
        report = check_design(self.folder)
        self.assertIn("clearance", {r["check"] for r in report["failed"]})

    def test_unknown_part(self):
        write_design(self.folder, part_id="not-a-real-part")
        self.assert_fails_only(["part"])

    def test_missing_design_file(self):
        self.folder.mkdir(parents=True)
        self.assert_fails_only(["design_file"])

    def test_file_outside_the_design_folder(self):
        write_design(self.folder)
        path = self.folder / "design.json"
        design = json.loads(path.read_text(encoding="utf-8"))
        design["print"]["PRINT_Carrier"] = "../secret.stl"
        path.write_text(json.dumps(design), encoding="utf-8")
        self.assert_fails_only(["files"])

    def test_unknown_insert_direction(self):
        write_design(self.folder, insert_from="sideways")
        self.assert_fails_only(["holds"])


if __name__ == "__main__":
    unittest.main()
