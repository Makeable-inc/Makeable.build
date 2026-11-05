"""Body rules on real geometry and the body agent's tools, with no model calls (costs nothing).
Run: .venv/Scripts/python -W ignore -m unittest test_body_agent"""
import json
import tempfile
import unittest
from pathlib import Path

import body_agent
import body_rules
from checks import load_stl

HERE = Path(__file__).resolve().parent
EXAMPLE = (HERE / "body_examples" / "kitten.py").read_text(encoding="utf-8")
EXPORT = '\nfrom build123d import export_stl, export_step\nexport_stl(body, "BODY.stl", tolerance=0.01)\nexport_step(body, "BODY.step")\n'
KITTEN = [{"name": n, "where": w} for n, w in (("left ear", "top left"), ("right ear", "top right"),
                                               ("left paw", "bottom left front"), ("right paw", "bottom right front"))]
BASE = {"features": KITTEN, "max_depth": 80, "width_to_height": [1.5, 2.6], "min_body": {"width": 101, "depth": 42, "height": 53},
        "sheet": [], "look": "a kitten"}


class Shop(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.shop = body_agent.BodyShop(Path(cls.tmp.name), BASE, None)
        cls.built = cls.shop.build(EXAMPLE + EXPORT)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_the_worked_example_builds_and_passes_the_fit_and_print_rules(self):
        self.assertTrue(self.built.startswith("Ran."), self.built)
        from unittest import mock
        with mock.patch("body_stage.screen_limits", lambda _b: {"max_width": 140, "max_height": 70, "tight_width": 110, "tight_height": 55}):
            report = json.loads(self.shop.check("all"))
        self.assertEqual(report["failed"], [], report)

    def test_a_missing_feature_is_named(self):
        found = body_rules.check(self.shop.mesh, BASE, KITTEN + [{"name": "tail", "where": "back"}], self.shop.output, groups=("features",))
        self.assertEqual([r["rule"] for r in found if not r["ok"]], ["feature:tail"])

    def test_docs_and_measure_work_on_the_built_body(self):
        self.assertIn("soft_box(", self.shop.docs("soft_box"))
        self.assertRegex(self.shop.measure("print(round(surface_z(body, 0, 0), 1))"), r"\d")


class StepRule(unittest.TestCase):
    def test_a_step_that_lost_a_feature_fails(self):
        from build123d import Box, export_step
        import trimesh
        with tempfile.TemporaryDirectory() as tmp:
            export_step(Box(100, 50, 60), f"{tmp}/small.step")
            wide = trimesh.creation.box(extents=(130, 50, 60))
            self.assertFalse(body_rules.step_rule(f"{tmp}/small.step", wide)["ok"])



class Gates(unittest.TestCase):
    """The staged look reviews and the latest-file rule, with a fake reviewer."""

    def setUp(self):
        from unittest import mock
        from PIL import Image
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        folder = Path(tmp.name)
        picture = folder / "concept.png"
        Image.new("RGB", (16, 16), "white").save(picture)
        base = {**BASE, "parts": "esp32-s3-devkit-n16r8,ssd1309-242-oled,ttp223-touch"}
        self.shop = body_agent.BodyShop(folder, base, picture)
        self.asked = []
        limits = {"max_width": 140, "max_height": 58, "tight_width": 110, "tight_height": 55, "screen_width": 55, "screen_height": 28}
        for target in (mock.patch("body_stage.screen_limits", lambda _b: limits), mock.patch("review_facts.screen_limits", lambda _b: limits),
                       mock.patch.object(body_agent, "ask", self.fake_ask), mock.patch.object(body_agent.BodyShop, "view", lambda s: picture)):
            target.start()
            self.addCleanup(target.stop)
        self.score = 5

    def fake_ask(self, prompt, _board):
        self.asked.append(prompt)
        return {"score": self.score, "fix": ["Increase body height by 40% to match the concept", "Make the ears broader at the root"]}, 10

    def test_the_character_gate_blocks_submit_then_records_a_skip(self):
        self.shop.build(EXAMPLE + EXPORT)
        self.assertTrue(any("Does it read as the concept" in p for p in self.asked), "the character review ran on build")
        self.assertIn("touch button", self.asked[-1])
        blocked = self.shop.submit()
        self.assertIn("under 7", blocked)
        self.assertEqual(self.shop.submits, 0)
        self.shop.build()
        self.assertEqual(len(self.shop.skipped_gates), 1)
        self.assertNotIn("under 7", self.shop.submit()[:40])

    def test_a_fix_the_limits_cannot_allow_is_dropped(self):
        self.shop.build(EXAMPLE + EXPORT)
        self.assertNotIn("Increase body height", " ".join(self.shop.last_fixes))
        self.assertIn("Make the ears broader at the root", self.shop.last_fixes)

    def test_a_changed_script_must_be_built_before_submit(self):
        self.score = 8
        self.shop.build(EXAMPLE + EXPORT)
        self.shop.script.edit("WIDTH, DEPTH, HEIGHT = 110.0, 64.0, 58.0", "WIDTH, DEPTH, HEIGHT = 108.0, 64.0, 58.0")
        self.assertIn("build() it first", self.shop.submit())


if __name__ == "__main__":
    unittest.main()
