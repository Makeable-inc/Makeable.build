"""The way back from the case stage to the body stage, with fake agents (costs nothing): when no working case fits a
body, the case stage's reasons reach the next body's brief, and the best attempt is kept.
Run: .venv/Scripts/python -W ignore -m unittest test_agent_pipeline"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import agent_pipeline
import case_agent


class WayBack(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        self.bodies = []

    def run_with(self, cases):
        cases = iter(cases)

        def body(base, picture, folder, resume=False):
            self.bodies.append(base)
            return "body = 1", Path(folder) / "BODY.stl", {"best_score": 6, "result": "draft"}

        def case(brief, folder, base, stl, picture, part_ids, system, resume=False):
            return next(cases)
        with mock.patch.object(agent_pipeline.body_agent, "design_body", body), \
                mock.patch.object(agent_pipeline.case_agent, "design_case", case), \
                mock.patch.object(agent_pipeline, "library_brief", lambda *_: "library"), \
                mock.patch.object(agent_pipeline, "frozen_body_brief", lambda *_: "frozen"), \
                mock.patch.object(agent_pipeline.agent, "base_brief", lambda *_: "base"), \
                mock.patch.object(agent_pipeline.agent, "start_job", lambda: None):
            return agent_pipeline.design_enclosure({"parts": "a"}, None, ["a"], self.folder, report=lambda *_: None)

    def test_a_case_that_cannot_fit_sends_its_reasons_to_a_second_body(self):
        failed = {"best": None, "look_score": None, "result": "failed",
                  "body_feedback": "The case could not be built inside this body.\n- A screw post at x=-45 would stick out of the body."}
        passed = {"best": "x/best", "look_score": 7, "result": "draft: fits, look goal not met (7/10)", "body_feedback": None}
        summary = self.run_with([failed, passed])
        self.assertEqual(len(self.bodies), 2)
        self.assertNotIn("case_feedback", self.bodies[0])
        self.assertIn("screw post at x=-45", self.bodies[1]["case_feedback"])
        self.assertEqual(summary["best_attempt"], 2)

    def test_a_working_case_needs_no_second_body(self):
        passed = {"best": "x/best", "look_score": 6, "result": "draft", "body_feedback": None}
        summary = self.run_with([passed])
        self.assertEqual(len(self.bodies), 1)
        self.assertEqual(summary["best_attempt"], 1)

    def test_the_brief_carries_the_case_reasons(self):
        import body_agent
        with mock.patch("body_stage.body_brief", lambda _b: "the brief"), mock.patch("review_facts.space_report", lambda _b: None):
            text = body_agent.brief({"case_feedback": "- A stop at x=-35 would run outside the body.", "features": []})
        self.assertIn("could not fit a working case", text)
        self.assertIn("x=-35", text)


class Troubles(unittest.TestCase):
    def test_the_reasons_that_name_the_body_are_kept(self):
        shop = case_agent.Workshop.__new__(case_agent.Workshop)
        shop.troubles = []
        shop.note_trouble("The code crashed:\nTraceback...\nAssertionError: A screw post at x=-45, z=53 would stick out of the body.")
        shop.note_trouble("parts_gap (PRINT_Shell / PRINT_Base): leave 0.1 mm")
        text = shop.body_feedback()
        self.assertIn("A screw post at x=-45, z=53 would stick out of the body.", text)
        self.assertNotIn("Traceback", text)


if __name__ == "__main__":
    unittest.main()
