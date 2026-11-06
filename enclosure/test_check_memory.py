"""The parts-gap check gives the same gap as a full search, without the full search's memory (it ran out of memory on
the kitten and TV cases in runs/tuning-6a-v3), and a check that crashes comes back to the case agent as a marked
tool failure instead of ending the run.
Run: .venv/Scripts/python -W ignore -m unittest test_check_memory"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import trimesh

import case_checks
import harness


def box(size, at):
    return trimesh.creation.box(extents=size, transform=trimesh.transformations.translation_matrix(at))


def full_search_gap(a, b):
    """The old way: every point of each part against the other, in one query."""
    pa, pb = case_checks.plastic_points(a), case_checks.plastic_points(b)
    return float(min(trimesh.proximity.closest_point(b, pa)[1].min(), trimesh.proximity.closest_point(a, pb)[1].min()))


class Gap(unittest.TestCase):
    def test_the_gap_matches_a_full_search(self):
        shell = trimesh.boolean.difference([box((100, 60, 50), (0, 0, 25)), box((96, 56, 48), (0, -2, 25))], engine="manifold")
        cover = box((90, 3, 44), (0, 28.0 - 1.5 - 0.6, 25))   # sits 0.6 mm inside the open back
        got = case_checks.check_plastic_pairs({"PRINT_Shell": shell, "PRINT_Base": cover})[0]["measured"]
        self.assertAlmostEqual(got, round(full_search_gap(shell, cover), 3), places=2)

    def test_parts_far_apart_report_at_least_the_margin(self):
        result = case_checks.check_plastic_pairs({"A": box((10, 10, 10), (0, 0, 0)), "B": box((10, 10, 10), (40, 0, 0))})[0]
        self.assertTrue(result["ok"])
        self.assertGreaterEqual(result["measured"], case_checks.NEAR_MARGIN)

    def test_a_dense_part_is_queried_in_batches(self):
        dense = trimesh.creation.icosphere(subdivisions=6, radius=30)          # 82k faces, 41k vertices
        plate = box((80, 3, 80), (0, 34, 0))
        sizes = []
        real = trimesh.proximity.closest_point

        def spy(mesh, points):
            sizes.append(len(points))
            return real(mesh, points)
        with mock.patch.object(case_checks.trimesh.proximity, "closest_point", spy):
            case_checks.check_plastic_pairs({"PRINT_Shell": dense, "PRINT_Base": plate})
        self.assertLessEqual(max(sizes), case_checks.QUERY_BATCH)
        self.assertLess(sum(sizes), len(dense.vertices) + 8000, "points far from the plate are not queried")


class CheckCrash(unittest.TestCase):
    def test_a_crashing_check_is_a_marked_tool_failure_and_not_a_submit(self):
        import case_agent
        shop = case_agent.Workshop.__new__(case_agent.Workshop)
        shop.ran, shop.report, shop.submits, shop.troubles = True, None, 0, []
        shop.script = mock.Mock(text="x = 1")
        shop.ran_code = "x = 1"
        shop.work = Path(tempfile.gettempdir())

        def boom(*_a, **_k):
            np.zeros((10 ** 6, 10 ** 6))   # raises MemoryError, like the real crash
        with mock.patch.object(case_agent.checks, "check_design", boom):
            text = shop.submit()
        self.assertEqual(shop.submits, 0)
        shown = json.loads(harness.marked(text))
        self.assertEqual((shown["ok"], shown["kind"]), (False, "crash"))
        self.assertIn("MemoryError", shown["error"])
        self.assertEqual(shown["source"], "tool")


if __name__ == "__main__":
    unittest.main()
