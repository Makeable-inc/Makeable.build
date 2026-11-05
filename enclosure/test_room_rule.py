"""The room rule reads the main form, not its ornaments: a tail on one side does not pull the parts' box off centre,
and a front that curves back at the sides still counts, while a body too small for the parts still fails.
Run: .venv/Scripts/python -W ignore -m unittest test_room_rule"""
import tempfile
import unittest

import trimesh

import body_parts as bp
import body_rules

ROOM = {"min_body": {"width": 100, "depth": 42, "height": 50}}


def mesh(solid):
    from build123d import export_stl
    with tempfile.TemporaryDirectory() as tmp:
        export_stl(solid, f"{tmp}/b.stl", tolerance=0.01)
        return trimesh.load(f"{tmp}/b.stl")


class RoomRule(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blob = bp.flat_sole(bp.superblob(108, 60, 66, roundness=4, top=2.5, shoulder=1 - 51 / 66))

    def test_a_soft_main_form_with_a_curved_front_holds_the_room(self):
        self.assertTrue(body_rules.room_rule(mesh(self.blob), ROOM)["ok"])

    def test_a_tail_on_one_side_does_not_move_the_room(self):
        tail = bp.spine_body([(50, 20), (64, 22), (76, 30)], [(9, 8), (6, 6), (3, 3)])
        with_tail = bp.fuse(self.blob, tail, "tail")
        self.assertGreater(bp.bounds(with_tail)[1][0], 70, "the tail is on")
        self.assertTrue(body_rules.room_rule(mesh(with_tail), ROOM)["ok"])

    def test_a_body_too_small_for_the_parts_still_fails(self):
        small = bp.flat_sole(bp.superblob(96, 60, 66, roundness=4, top=2.5, shoulder=1 - 51 / 66))
        self.assertFalse(body_rules.room_rule(mesh(small), ROOM)["ok"])


class BackPlate(unittest.TestCase):
    def test_broad_flat_back_meets_the_rule_with_features_in_the_outline(self):
        body = bp.flat_sole(bp.superblob(108, 60, 66, roundness=4, top=2.5, shoulder=1 - 51 / 66))
        for side in (-1, 1):
            body = bp.fuse(body, bp.ear(width=20.0, height=14.0, thickness=12.0, sharpness=0.6,
                                        at=(side * 30, 0, bp.surface_z(body, side * 30, 0)), sink=6.0), "horn")
        body, _ = bp.broad_flat_back(body, share=0.65)
        share, flat = body_rules.back_plate(mesh(body))
        self.assertGreaterEqual(share, body_rules.BACK_PLATE_SHARE)


if __name__ == "__main__":
    unittest.main()
