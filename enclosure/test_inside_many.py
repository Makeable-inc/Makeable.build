"""The batched inside-the-body test gives the exact CAD answers, on a curved body with a raised panel and at shared
depths (as free_spots asks). Run: .venv/Scripts/python -W ignore -m unittest test_inside_many"""
import unittest

import numpy as np

import body_parts
import case_parts


class InsideMany(unittest.TestCase):
    def test_same_answers_as_the_exact_test(self):
        body = body_parts.superblob(100, 60, 80)
        body = case_parts.one_solid(body + case_parts.block([30, -34, 20], [48, 0, 50]), "body with a panel")
        b = body.bounding_box()
        rng = np.random.default_rng(1)
        points = [(x, y, z) for y in (b.max.Y - 0.3, b.max.Y - 9.0, 0.0, b.min.Y + 2)
                  for x, z in zip(rng.uniform(b.min.X - 1, b.max.X + 1, 60), rng.uniform(b.min.Z - 1, b.max.Z + 1, 60))]
        points += [tuple(p) for p in np.column_stack([rng.uniform(b.min.X, b.max.X, 15), rng.uniform(b.min.Y, b.max.Y, 15), rng.uniform(b.min.Z, b.max.Z, 15)])]
        exact = [case_parts.inside(body, *p) for p in points]
        self.assertEqual(case_parts.inside_many(body, points).tolist(), exact)
        self.assertGreater(sum(exact), 20)
        self.assertLess(sum(exact), len(points) - 20)


if __name__ == "__main__":
    unittest.main()
