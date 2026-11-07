"""Screws and stops placed from the spots that fit, never typed in: spread to both halves across and up (the
screw-spread rule), a narrow strip between parts is found, and a refused spot is skipped.
Run: .venv/Scripts/python -W ignore -m unittest test_placing"""
import unittest

import case_parts as cp


class FakePart:
    """A part seen only through its outline (x0, x1, z0, z1)."""
    def __init__(self, x0, x1, z0, z1, name="part"):
        self.box, self.name = (x0, x1, z0, z1), name


class Placing(unittest.TestCase):
    def setUp(self):
        real = cp.outline
        self.addCleanup(setattr, cp, "outline", real)
        cp.outline = lambda part, gap=cp.GAP: tuple(v + s * gap for v, s in zip(part.box, (-1, 1, -1, 1))) if isinstance(part, FakePart) else real(part, gap)

    def test_spread_reaches_every_corner_first(self):
        spots = [(x, z) for x in range(-40, 41, 10) for z in range(0, 51, 10)]
        first = cp.spread(spots, 4, centre=(0, 25))[:4]
        self.assertEqual(sorted(first), sorted([(-40, 50), (40, 50), (40, 0), (-40, 0)]))

    def test_a_strip_narrower_than_the_grid_is_found(self):
        # a part filling most of the left: the only room there is a 0.6 mm wide strip above it
        screen = FakePart(-48, -5, 3, 45.0)
        reach = cp.POST_RADIUS
        spots = cp.free_spots([screen], -50, 50, 3, 45 + cp.GAP + reach + 0.6, reach=reach)
        left = [s for s in spots if s[0] < -5]
        self.assertTrue(left, "the strip above the screen on the left is found")

    def test_screws_land_in_both_halves_and_refusals_are_skipped(self):
        made, real = [], cp.Screw

        class Picky:
            def __init__(self, x, z, *a, **k):
                if (x, z) == (-50, 51):
                    raise AssertionError("refused")
                self.x, self.z = x, z
                made.append((x, z))
        cp.Screw = Picky
        self.addCleanup(setattr, cp, "Screw", real)
        screws = cp.place_screws([], -50, 50, 3, 51, 30, 26, count=3)
        xs, zs = [s.x for s in screws], [s.z for s in screws]
        self.assertTrue(min(xs) < 0 < max(xs) and min(zs) < 27 < max(zs), (xs, zs))
        self.assertNotIn((-50, 51), [(s.x, s.z) for s in screws])

    def test_too_few_posts_say_why(self):
        with self.assertRaises(AssertionError) as caught:
            cp.place_screws([FakePart(-60, 60, -10, 70)], -50, 50, 3, 51, 30, 26, count=3)
        self.assertIn("Only 0 of 3 screw posts fit", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
