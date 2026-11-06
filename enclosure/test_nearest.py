"""The fast closest-point search gives trimesh's exact answers. Run: .venv/Scripts/python -W ignore -m unittest test_nearest"""
import unittest

import numpy as np
import trimesh

import nearest


class Nearest(unittest.TestCase):
    def test_same_distances_as_trimesh(self):
        mesh = trimesh.creation.icosphere(subdivisions=3, radius=20).union(trimesh.creation.box((30, 10, 50)))
        points = np.random.default_rng(2).uniform(-30, 30, (500, 3))
        _, expected, _ = trimesh.proximity.closest_point(mesh, points)
        closest, found, triangles = nearest.closest_point(mesh, points)
        self.assertLess(np.abs(found - expected).max(), 1e-6)
        self.assertLess(np.abs(np.linalg.norm(closest - points, axis=1) - found).max(), 1e-6)
        self.assertEqual(len(triangles), len(points))


if __name__ == "__main__":
    unittest.main()
