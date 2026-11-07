"""body_parts: every building block is a valid solid, and features joined onto a body stay one valid solid."""
import itertools
import runpy
import unittest
from pathlib import Path

import body_parts as bp

HERE = Path(__file__).resolve().parent


def loaf():
    return bp.oval_loft([(0, 50, 30), (14, 54, 33), (36, 53, 32), (52, 46, 28)], dome=9)


class Primitives(unittest.TestCase):
    def test_each_primitive_is_one_valid_solid(self):
        shapes = {
            "ellipsoid": bp.ellipsoid(10, 7, 5, at=(3, 4, 5), tilt=(10, 20, 30)),
            "capsule": bp.capsule(4, 20, tilt=(0, 90, 0)),
            "cone_tip": bp.cone_tip(6, 15),
            "oval_loft": loaf(),
            "rounded_box": bp.rounded_box(60, 40, 30, 8),
            "ear": bp.ear(18, 16, 7, at=(0, 0, 0)),
            "paw": bp.paw(18, 16, 8, at=(0, 0, 0)),
            "antenna": bp.antenna(14),
        }
        for name, shape in shapes.items():
            with self.subTest(name):
                self.assertTrue(shape.is_valid)
                self.assertEqual(len(shape.solids()), 1)
                self.assertGreater(shape.volume, 10)

    def test_round_tipped_ear_keeps_its_volume(self):
        # A round tip whose outline matched the top section used to lose most of the ear in the join.
        for sharp in (0.2, 0.3, 0.45, 0.6):
            with self.subTest(sharp=sharp):
                self.assertGreater(bp.ear(20, 16, 8, at=(0, 0, 0), sharpness=sharp).volume, 900)

    def test_bad_sizes_raise_clearly(self):
        with self.assertRaises(AssertionError):
            bp.ellipsoid(0, 5, 5)
        with self.assertRaises(AssertionError):
            bp.oval_loft([(10, 5, 5), (0, 5, 5)])


class Joins(unittest.TestCase):
    def test_ears_join_at_many_spots_and_angles(self):
        body = loaf()
        for x, y, tilt, sharp in itertools.product((-30, -15, 15, 30), (-10, 5), (0, 15), (0.2, 0.45)):
            with self.subTest(x=x, y=y, tilt=tilt, sharp=sharp):
                z = bp.surface_z(body, x, y)
                out = bp.join(body, bp.ear(20, 16, 8, at=(x, y, z), tilt=(0, tilt if x > 0 else -tilt, 0), sharpness=sharp), "ear")
                self.assertTrue(out.is_valid)
                self.assertGreater(bp.bounds(out)[1][2], bp.bounds(body)[1][2])

    def test_paws_at_bottom_corners_then_flat_sole_stands_flat(self):
        body = loaf()
        for sx in (-1, 1):
            body = bp.join(body, bp.paw(18, 16, 9, at=(sx * 38, -22, 0)), "paw")
        body = bp.flat_sole(body)
        self.assertAlmostEqual(bp.bounds(body)[0][2], 0.0, places=2)
        self.assertTrue(body.is_valid)

    def test_side_features_join(self):
        body = loaf()
        for side in (-1, 1):
            x = bp.surface_x(body, 0, 25, side)
            arm = bp.capsule(5, 18, at=(x + side * 6, 0, 25), tilt=(0, 90, 0))
            body = bp.join(body, arm, "arm")
        self.assertTrue(body.is_valid)

    def test_spike_row_joins(self):
        body = loaf()
        spikes = bp.spike_row(5, 5, 12, start=(-35, 0, bp.surface_z(body, -35, 0)), end=(35, 0, bp.surface_z(body, 35, 0)))
        added, skipped = [], []
        for i, spike in enumerate(spikes):
            body = bp.try_join(body, spike, f"spike {i}", added, skipped)
        self.assertEqual(len(added), 5, skipped)

    def test_a_floating_feature_is_skipped_not_crashed(self):
        body = loaf()
        added, skipped = [], []
        out = bp.try_join(body, bp.ellipsoid(5, 5, 5, at=(0, 0, 200)), "floating", added, skipped)
        self.assertEqual(added, [])
        self.assertEqual(len(skipped), 1)
        self.assertAlmostEqual(out.volume, body.volume, places=3)

    def test_flat_back(self):
        out = bp.flat_back(loaf(), 20)
        self.assertAlmostEqual(bp.bounds(out)[1][1], 20, places=2)


class Example(unittest.TestCase):
    def test_worked_kitten_example_builds_with_all_features(self):
        scope = runpy.run_path(str(HERE / "body_examples" / "kitten.py"))
        body, added, skipped = scope["body"], scope["added"], scope["skipped"]
        self.assertTrue(body.is_valid)
        self.assertEqual(len(added), 4, skipped)
        self.assertAlmostEqual(bp.bounds(body)[0][2], 0.0, places=2)


class StepRoundTrip(unittest.TestCase):
    def test_a_joined_ellipsoid_survives_step_on_every_side(self):
        """The robot's left arm vanished from BODY.step (still in BODY.stl): the case stage loads the STEP."""
        import tempfile
        from build123d import Box, export_step, import_step
        import body_parts as bp
        with tempfile.TemporaryDirectory() as tmp:
            for at in ((-52.5, 0, 0), (52.5, 0, 0), (0, 0, 32)):
                joined = bp.join(Box(100, 50, 60), bp.ellipsoid(10.5, 8, 7.5, at=at), "arm")
                path = f"{tmp}/arm.step"
                export_step(joined, path)
                np_before, np_after = bp.bounds(joined), bp.bounds(import_step(path))
                for a, b in zip(np_before[0] + np_before[1], np_after[0] + np_after[1]):
                    self.assertAlmostEqual(a, b, delta=0.2, msg=f"arm at {at}")


class SoftForms(unittest.TestCase):
    """The soft main forms: exact size, sealed, and the same after a STEP round trip (the case stage loads the STEP)."""

    def round_trip(self, solid):
        import tempfile
        from build123d import export_step, import_step
        with tempfile.TemporaryDirectory() as tmp:
            export_step(solid, f"{tmp}/s.step")
            before, after = bp.bounds(solid), bp.bounds(import_step(f"{tmp}/s.step"))
        return max(abs(a - b) for a, b in zip(before[0] + before[1], after[0] + after[1]))

    def test_superblob_is_its_exact_size_and_step_safe(self):
        for top in (2, 3, 5):
            blob = bp.superblob(110, 64, 58, roundness=3, top=top)
            for got, want in zip(bp.size(blob), (110.0, 64.0, 58.0)):
                self.assertAlmostEqual(got, want, delta=0.2, msg=f"top={top}")
            self.assertLess(self.round_trip(blob), 0.3)

    def test_a_low_shoulder_holds_a_box_shaped_room(self):
        from build123d import Box, Pos
        blob = bp.superblob(108, 60, 64, roundness=4, top=2.5, shoulder=0.4)
        self.assertEqual(len(blob.solids()), 1)
        self.assertTrue(blob.is_valid)
        for got, want in zip(bp.size(blob), (108.0, 60.0, 64.0)):
            self.assertAlmostEqual(got, want, delta=0.3)
        self.assertLess(self.round_trip(blob), 0.3)
        room = Pos(0, 0, 25) * Box(96, 50, 50)
        self.assertLess((room - blob).volume, 0.01 * room.volume, "the room sticks out of the body")

    def test_a_short_tail_with_three_points_is_a_clean_mesh(self):
        tail = bp.spine_body([(40, 20), (54, 22), (64, 30)], [(9, 8), (6, 6), (3, 3)])
        self.assertEqual(len(tail.solids()), 1)
        lo, hi = bp.bounds(tail)
        self.assertLess(hi[0] - lo[0], 60, "a broken mesh blows the bounds up")

    def test_spine_body_flows_into_a_tapered_tail_and_is_step_safe(self):
        body = bp.spine_body([(-60, 22), (-30, 24), (0, 24), (30, 22), (55, 22), (70, 32)],
                             [(26, 22), (28, 24), (28, 24), (24, 21), (12, 10), (4, 4)])
        self.assertEqual(len(body.solids()), 1)
        self.assertLess(self.round_trip(body), 0.3)
        lo, hi = bp.bounds(body)
        self.assertGreater(hi[0], 70, "the tail tip reaches past the last spine point")


if __name__ == "__main__":
    unittest.main()
