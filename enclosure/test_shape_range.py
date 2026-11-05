"""The main-form blocks work over their whole range of settings, not only at the values a worked example uses: every
call gives one valid solid of the asked size, or a clear ValueError naming what to change. A CAD crash is a bug.
Run: .venv/Scripts/python -W ignore -m unittest test_shape_range"""
import contextlib
import io
import random
import unittest

import body_parts as bp

# Settings the tuning agents actually tried that crashed (kitten and dino, runs/tuning-6a), plus the corners of the range.
KNOWN = [
    dict(width=109.8, depth=62.0, height=56.5, roundness=4.8, top=2.5, shoulder=-0.03),   # kitten: shoulder from the example's formula
    dict(width=110.4, depth=62.0, height=36.8, roundness=5.0, top=5.0, shoulder=0.01),    # dino: almost no spare height
    dict(width=110.4, depth=62.0, height=36.8, roundness=5.0, top=5.0, shoulder=0.1),     # dino: flat top
    dict(width=100, depth=60, height=60, roundness=5, top=5, shoulder=1.0),               # flat top, full height
    dict(width=100, depth=60, height=60, roundness=2, top=2, shoulder=0.0),
    dict(width=100, depth=60, height=60, roundness=6, top=6, shoulder=0.05),
    dict(width=40, depth=30, height=20, roundness=2, top=2, shoulder=1.0),
    dict(width=160, depth=90, height=90, roundness=6, top=2, shoulder=0.3),
]


def random_settings(count, seed=7):
    rng = random.Random(seed)
    for _ in range(count):
        yield dict(width=rng.uniform(40, 160), depth=rng.uniform(30, 90), height=rng.uniform(20, 90),
                   roundness=rng.uniform(2, 6), top=rng.uniform(2, 6), shoulder=rng.uniform(-0.1, 1.1))


class SuperblobRange(unittest.TestCase):
    def assert_good(self, s):
        with contextlib.redirect_stdout(io.StringIO()):
            blob = bp.superblob(**s)
        self.assertEqual(len(blob.solids()), 1, s)
        self.assertTrue(blob.is_valid, s)
        for got, want in zip(bp.size(blob), (s["width"], s["depth"], s["height"])):
            self.assertAlmostEqual(got, want, delta=0.4, msg=s)
        return blob

    def test_the_settings_that_crashed_in_the_tuning_runs(self):
        for s in KNOWN:
            with self.subTest(**s):
                self.assert_good(s)

    def test_random_settings_over_the_whole_range(self):
        for s in random_settings(40):
            with self.subTest(**{k: round(v, 2) for k, v in s.items()}):
                self.assert_good(s)

    def test_a_flatter_shape_than_asked_is_reported(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            bp.superblob(110, 62, 36.8, roundness=5, top=2.5, shoulder=0.01)
        self.assertIn("superblob note", out.getvalue())
        self.assertRegex(out.getvalue(), r"\d+(\.\d+)? mm")

    def test_a_flat_top_has_no_spike(self):
        blob = bp.superblob(100, 60, 60, roundness=5, top=5, shoulder=0.5)
        # the top is flat: the highest points spread over the top, not one spike in the middle
        points, _ = blob.tessellate(0.1, 0.3)
        near_top = [p for p in points if p.Z > 59.5]
        spread = max(p.X for p in near_top) - min(p.X for p in near_top)
        self.assertGreater(spread, 30)

    def test_impossible_sizes_say_what_to_change(self):
        for bad in (dict(width=0, depth=60, height=60), dict(width=100, depth=60, height=-5)):
            with self.subTest(**bad), self.assertRaises(ValueError) as caught:
                bp.superblob(**bad)
            self.assertIn("mm", str(caught.exception))


class SpineRange(unittest.TestCase):
    def test_random_spines(self):
        rng = random.Random(11)
        for _ in range(15):
            n = rng.randint(3, 7)
            xs = sorted(rng.uniform(-60, 70) for _ in range(n))
            xs = [x + 12 * i for i, x in enumerate(xs)]
            spine = [(x, rng.uniform(15, 35)) for x in xs]
            sizes = [(rng.uniform(4, 30), rng.uniform(4, 28)) for _ in range(n)]
            with self.subTest(spine=spine, sizes=sizes):
                body = bp.spine_body(spine, sizes, roundness=rng.uniform(2, 3.5))
                self.assertEqual(len(body.solids()), 1)
                self.assertTrue(body.is_valid)
                lo, hi = bp.bounds(body)
                self.assertLess(hi[0] - lo[0], (xs[-1] - xs[0]) + 80, "a broken mesh blows the bounds up")

    def test_a_straight_capsule_has_no_ridge(self):
        body = bp.spine_body([(-50, 25), (-20, 26), (20, 26), (50, 25)], [(25, 22), (27, 24), (27, 24), (25, 22)])
        # the top line along the length: no step bigger than the asked sizes explain
        heights = [bp.surface_z(body, x, 0) for x in range(-40, 41, 4)]
        steps = [abs(b - a) for a, b in zip(heights, heights[1:])]
        self.assertLess(max(steps), 1.0, heights)


if __name__ == "__main__":
    unittest.main()
