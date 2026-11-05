"""Visual QA of a finished character case, with a fake reviewer (costs nothing).
Run: .venv/Scripts/python -W ignore -m unittest test_case_look"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

import case_look

FEATURES = [{"name": "left arm", "where": "left side"}, {"name": "antenna", "where": "top middle"}]


class Review(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.attempt = Path(tmp.name) / "try-1"
        self.attempt.mkdir()
        for name in ("concept.png", "body_view.png"):
            Image.new("RGB", (40, 40), "white").save(Path(tmp.name) / name)
        Image.new("RGB", (80, 40), "white").save(self.attempt / "preview.png")
        self.picture = Path(tmp.name) / "concept.png"

    def run_review(self, reply, body_score=8):
        with mock.patch.object(case_look, "ask", lambda _p, _i: (reply, 10)):
            return case_look.review(self.attempt, self.picture, {"features": FEATURES}, body_score)

    def test_a_lost_feature_fails_even_when_named_with_its_place(self):
        look = self.run_review({"features": {"left arm (left side)": "missing", "antenna (top middle)": "present"}, "score": 7, "fix": ["restore the arm"]})
        verdict = case_look.as_check(look)
        self.assertFalse(verdict["ok"])
        self.assertIn("left arm", verdict["fix"])
        self.assertIn("restore the arm", verdict["fix"])

    def test_a_small_score_drop_is_noise_but_a_big_one_fails(self):
        keep = {"features": {"left arm": "present", "antenna": "present"}, "fix": []}
        self.assertTrue(case_look.as_check(self.run_review({**keep, "score": 7}))["ok"])
        self.assertFalse(case_look.as_check(self.run_review({**keep, "score": 6}))["ok"])

    def test_fixes_are_passed_on_when_nothing_fails(self):
        look = self.run_review({"features": {"left arm": "present", "antenna": "weak"}, "score": 8, "fix": ["round the bezel"]})
        verdict = case_look.as_check(look)
        self.assertTrue(verdict["ok"])
        self.assertIn("round the bezel", verdict["fix"])


if __name__ == "__main__":
    unittest.main()
