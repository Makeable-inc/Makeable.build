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


if __name__ == "__main__":
    unittest.main()
