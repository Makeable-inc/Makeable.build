"""Stop rule tests with a fake AI, so the loop can be tested for free. Run: .venv/Scripts/python -W ignore -m unittest test_agent"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import agent

CRASHES = "```python\nraise ValueError('boom')\n```"
BANNED = "```python\nimport os\n```"


def fake_checks(failures):
    """Each try reports the next list of (check, measured) failures, built without any real geometry."""
    sequence = iter(failures)

    def check_design(_folder, _stage="carrier"):
        failed = [{"check": c, "part": "PRINT_Carrier", "measured": m, "limit": "limit", "where": None, "fix": "fix it", "ok": False} for c, m in next(sequence)]
        return {"passed": not failed, "failed": failed, "results": failed}
    return check_design


class Loop(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        self.prompts = []

    def run_loop(self, replies, failures=(), max_tries=agent.MAX_TRIES_PER_PART, tokens=100):
        replies = iter(replies)

        def fake_model(_instructions, text):
            self.prompts.append(text)
            return next(replies), {"total_tokens": tokens}
        with mock.patch.object(agent, "ask_model", fake_model), mock.patch.object(agent.checks, "check_design", fake_checks(failures)):
            return agent.design_part("brief", self.folder, max_tries)

    def test_pass_stops_at_once(self):
        result = self.run_loop(["```python\nprint(1)\n```"], [[]])
        self.assertEqual((result["outcome"], result["tries"]), ("passed", 1))

    def test_fixes_on_the_second_try_and_sends_the_error_back(self):
        result = self.run_loop(["```python\nprint(1)\n```"] * 2, [[("clearance", 0.02)], []])
        self.assertEqual((result["outcome"], result["tries"]), ("passed", 2))
        self.assertIn("fix it", self.prompts[1])
        self.assertIn("print(1)", self.prompts[1])

    def test_same_failure_twice_stops(self):
        result = self.run_loop(["```python\nprint(1)\n```"] * 5, [[("clearance", 0.02)]] * 5)
        self.assertEqual(result["outcome"], "stopped: same failure twice")
        self.assertEqual(result["tries"], 2)

    def test_same_check_with_a_new_number_keeps_going(self):
        result = self.run_loop(["```python\nprint(1)\n```"] * 3, [[("clearance", 0.02)], [("clearance", 0.06)], []])
        self.assertEqual(result["outcome"], "passed")

    def test_getting_worse_stops(self):
        worse = [("clearance", 0.02), ("held", 2), ("wall", 1), ("usb_access", 3)]
        result = self.run_loop(["```python\nprint(1)\n```"] * 5, [[("clearance", 0.02)], worse])
        self.assertIn("getting worse", result["outcome"])
        self.assertEqual(result["tries"], 2)

    def test_an_early_stop_in_the_checks_is_not_counted_as_better(self):
        partial = {"passed": False, "complete": False, "failed": [{"check": "sealed", "part": "PRINT_Shell", "measured": 1, "limit": "l", "where": None, "fix": "f", "ok": False}], "results": []}
        full = {"passed": False, "complete": True, "failed": [{"check": c, "part": "p", "measured": 1, "limit": "l", "where": None, "fix": "f", "ok": False} for c in "abcde"], "results": []}
        done = {"passed": True, "complete": True, "failed": [], "results": []}
        reports = iter([partial, full, done])
        with mock.patch.object(agent, "ask_model", lambda _i, _t: ("```python\nprint(1)\n```", {"total_tokens": 1})), mock.patch.object(agent.checks, "check_design", lambda _f, _s="carrier": next(reports)):
            result = agent.design_part("brief", self.folder, 6)
        self.assertEqual(result["outcome"], "passed")

    def test_one_extra_failure_keeps_going(self):
        result = self.run_loop(["```python\nprint(1)\n```"] * 3, [[("clearance", 0.02)], [("wall", 0.02), ("held", 2)], []])
        self.assertEqual(result["outcome"], "passed")

    def test_no_progress_stops(self):
        failures = [[("clearance", 0.01)], [("wall", 0.02)], [("held", 0.03)], []]
        result = self.run_loop(["```python\nprint(1)\n```"] * 4, failures, max_tries=6)
        self.assertIn("no progress", result["outcome"])
        self.assertEqual(result["tries"], 3)

    def test_try_limit_stops(self):
        failures = [[("clearance", 0.01)], [("clearance", 0.02)], [("clearance", 0.03)], [("clearance", 0.04)]]
        result = self.run_loop(["```python\nprint(1)\n```"] * 4, failures)
        self.assertEqual(result["outcome"], f"stopped: used all {agent.MAX_TRIES_PER_PART} tries")

    def test_token_limit_stops(self):
        result = self.run_loop(["```python\nprint(1)\n```"] * 3, [[("clearance", 0.01)], [("clearance", 0.02)]], tokens=agent.MAX_TOKENS)
        self.assertIn("tokens", result["outcome"])
        self.assertEqual(result["tries"], 1)

    def test_crash_goes_back_as_an_error(self):
        result = self.run_loop([CRASHES, "```python\nprint(1)\n```"], [[]])
        self.assertEqual(result["outcome"], "passed")
        self.assertIn("boom", self.prompts[1])

    def test_banned_import_is_not_run(self):
        result = self.run_loop([BANNED, "```python\nprint(1)\n```"], [[]])
        self.assertEqual(result["outcome"], "passed")
        self.assertIn("not allowed", self.prompts[1])

    def test_every_try_is_saved(self):
        self.run_loop(["```python\nprint(1)\n```"] * 2, [[("clearance", 0.02)], []])
        for name in ("try-1", "try-2"):
            for file in ("prompt.txt", "design.py", "report.json"):
                self.assertTrue((self.folder / name / file).exists(), f"{name}/{file}")
        self.assertTrue((self.folder / "summary.json").exists())


if __name__ == "__main__":
    unittest.main()
