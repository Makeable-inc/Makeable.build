"""The case front is measured at the screen, so ornaments (antennas, arms) do not count; a bigger face still does.
Run: .venv/Scripts/python -W ignore -m unittest test_face_size"""
import unittest

import numpy as np
import trimesh

import case_checks


def robot():
    """A 100 x 50 x 60 box (front at y = -25) with an antenna on top and an arm on each side, away from the front."""
    body = trimesh.creation.box(extents=(100, 50, 60), transform=trimesh.transformations.translation_matrix((0, 0, 30)))
    antenna = trimesh.creation.cylinder(radius=3, height=30, transform=trimesh.transformations.translation_matrix((0, 5, 70)))
    arms = [trimesh.creation.box(extents=(20, 10, 10), transform=trimesh.transformations.translation_matrix((s * 58, 5, 30))) for s in (-1, 1)]
    return trimesh.boolean.union([body, antenna, *arms])


class FaceSize(unittest.TestCase):
    def test_the_case_check_leaves_out_ornaments_away_from_the_screen(self):
        mesh = robot()
        screen = {"min": [-30, -24, 15], "max": [30, -22, 45]}
        size = case_checks.face_size(mesh, screen, np.eye(4), 1, False, [0, 2])
        np.testing.assert_allclose(size, [100, 60], atol=0.5)

    def test_a_bigger_face_still_counts(self):
        mesh = trimesh.creation.box(extents=(140, 50, 80), transform=trimesh.transformations.translation_matrix((0, 0, 40)))
        screen = {"min": [-30, -24, 15], "max": [30, -22, 45]}
        size = case_checks.face_size(mesh, screen, np.eye(4), 1, False, [0, 2])
        np.testing.assert_allclose(size, [140, 80], atol=0.5)


class KeepsBody(unittest.TestCase):
    def test_a_lost_arm_fails_and_a_whole_case_passes(self):
        body = robot()
        whole = case_checks.check_keeps_body({"PRINT_Shell": body}, body)
        self.assertTrue(all(r["ok"] for r in whole))
        no_arm = trimesh.creation.box(extents=(100, 50, 60), transform=trimesh.transformations.translation_matrix((0, 0, 30)))
        lost = case_checks.check_keeps_body({"PRINT_Shell": no_arm}, body)
        self.assertFalse(next(r for r in lost if r["part"] == "front")["ok"])


if __name__ == "__main__":
    unittest.main()
