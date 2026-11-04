"""Character bodies: the rules on real geometry, and the loop with a fake AI (costs nothing).
Run: .venv/Scripts/python -W ignore -m unittest test_character_body"""
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import trimesh
from build123d import export_stl

import body_stage
import character_body as cb

HERE = Path(__file__).resolve().parent
EXAMPLE = (HERE / "body_examples" / "kitten.py").read_text(encoding="utf-8")
KITTEN = [{"name": "left ear", "kind": "ear", "where": "top left"}, {"name": "right ear", "kind": "ear", "where": "top right"},
          {"name": "left paw", "kind": "paw", "where": "bottom left front"}, {"name": "right paw", "kind": "paw", "where": "bottom right front"}]


def example_mesh(folder):
    body = runpy.run_path(str(HERE / "body_examples" / "kitten.py"))["body"]
    export_stl(body, str(folder / "k.stl"), tolerance=0.05)
    return trimesh.load_mesh(folder / "k.stl")


class Rules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.mesh = example_mesh(Path(cls.tmp.name))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_the_ears_are_found_on_the_shape_too(self):
        missing = cb.missing_features(self.mesh, KITTEN[:2])
        self.assertEqual(missing, [])

    def test_a_plain_body_has_no_features_on_the_shape(self):
        plain = trimesh.creation.box(extents=(110, 68, 60))
        self.assertEqual(len(cb.missing_features(plain, KITTEN)), 4)

    def test_features_are_checked_by_name_from_the_joins(self):
        output = "added: ['left ear', 'right ear', 'left paw'] skipped: ['right paw: overlaps by 0.0 mm3'] size: (1, 2, 3)"
        self.assertEqual(cb.added_names(output), {"left ear", "right ear", "left paw"})
        with mock.patch("body_stage.body_problems", lambda _m, _b: []):
            found = cb.problems(self.mesh, {}, KITTEN, output)
        self.assertEqual(len(found), 1)
        self.assertIn("right paw", found[0])

    def test_the_worked_kitten_back_plate_is_flat_and_broad(self):
        share, flat = cb.back_plate(self.mesh)
        self.assertGreaterEqual(flat, cb.BACK_PLATE_FLAT)
        self.assertGreaterEqual(share, cb.BACK_PLATE_SHARE)


class Loop(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        self.picture = self.folder / "concept.png"
        from PIL import Image
        Image.new("RGB", (64, 64), "white").save(self.picture)

    def run_loop(self, replies, review_score=8):
        replies = iter(replies)
        base = {"style": "character", "features": KITTEN}
        fake_review = lambda _p, attempt, features: {"score": review_score, "features": {f["name"]: "present" for f in features}, "changes": [], "tokens": 10}
        with mock.patch.object(cb.agent, "ask_model", lambda _s, _t, _p=None: (next(replies), {"total_tokens": 100})), \
                mock.patch.object(body_stage, "body_brief", lambda _b: "brief"), \
                mock.patch.object(cb, "review", fake_review), \
                mock.patch("body_stage.body_problems", lambda _m, _b: []):
            return body_stage.design_body(base, self.picture, self.folder / "body")

    def test_the_switch_sends_character_designs_here_and_the_example_passes_first_try(self):
        code, stl, summary = self.run_loop(["```python\n" + EXAMPLE + "\nfrom build123d import export_stl, export_step\nexport_stl(body, 'BODY.stl', tolerance=0.01)\nexport_step(body, 'BODY.step')\n```"])
        self.assertIsNotNone(stl)
        self.assertEqual(summary["style"], "character")
        self.assertEqual(len(summary["tries"]), 1)

    def test_a_crash_after_a_good_try_keeps_the_good_body(self):
        good = "```python\n" + EXAMPLE + "\nfrom build123d import export_stl, export_step\nexport_stl(body, 'BODY.stl', tolerance=0.01)\nexport_step(body, 'BODY.step')\n```"
        crash = "```python\nraise ValueError('loft failed')\n```"
        code, stl, summary = self.run_loop([good] + [crash] * cb.MAX_CRASHES, review_score=5)
        self.assertIsNotNone(stl)
        self.assertEqual(summary["best_score"], 5)
        prompt = (self.folder / "body" / "try-3" / "prompt.txt").read_text(encoding="utf-8")
        self.assertIn("Your best script so far", prompt)
        self.assertIn("loft failed", prompt)


if __name__ == "__main__":
    unittest.main()
