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


if __name__ == "__main__":
    unittest.main()
