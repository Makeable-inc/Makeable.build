"""Stop rule tests with a fake AI, so the loop can be tested for free. Run: .venv/Scripts/python -W ignore -m unittest test_agent"""
import io
import tempfile
import urllib.error
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
        agent.start_job()

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
        result = self.run_loop(["```python\nprint(1)\n```"] * 3, [[("clearance", 0.01)], [("clearance", 0.02)]], tokens=agent.JOB_TOKEN_LIMIT)
        self.assertIn("tokens", result["outcome"])
        self.assertEqual(result["tries"], 1)

    def test_the_limit_counts_what_earlier_stages_of_the_job_used(self):
        # The body stage already spent most of the job's tokens, so the case stage gets only what is left.
        agent.spend(agent.JOB_TOKEN_LIMIT - 30_000)
        result = self.run_loop(["```python\nprint(1)\n```"] * 4, [[("clearance", 0.01)], [("clearance", 0.02)], [("clearance", 0.03)]], tokens=20_000)
        self.assertEqual(result["tries"], 2)
        self.assertIn(str(agent.JOB_TOKEN_LIMIT), result["outcome"])

    def test_crash_goes_back_as_an_error(self):
        result = self.run_loop([CRASHES, "```python\nprint(1)\n```"], [[]])
        self.assertEqual(result["outcome"], "passed")
        self.assertIn("boom", self.prompts[1])

    def test_banned_import_is_not_run(self):
        result = self.run_loop([BANNED, "```python\nprint(1)\n```"], [[]])
        self.assertEqual(result["outcome"], "passed")
        self.assertIn("not allowed", self.prompts[1])

    def test_crashes_do_not_use_up_real_tries(self):
        replies = ["```python\nraise ValueError('one')\n```", "```python\nprint(1)\n```", "```python\nraise ValueError('two')\n```", "```python\nprint(2)\n```", "```python\nprint(3)\n```", "```python\nprint(4)\n```"]
        result = self.run_loop(replies, [[("clearance", 0.01)], [("clearance", 0.02)], [("clearance", 0.03)]], max_tries=3)
        self.assertEqual(result["outcome"], "stopped: used all 3 tries")
        self.assertEqual(result["tries"], 5)

    def test_same_crash_twice_stops(self):
        result = self.run_loop([CRASHES, CRASHES, CRASHES], [], max_tries=6)
        self.assertEqual(result["outcome"], "stopped: same crash twice")
        self.assertEqual(result["tries"], 2)

    def test_crash_budget_stops(self):
        replies = [f"```python\nraise ValueError('{i}')\n```" for i in range(6)]
        result = self.run_loop(replies, [], max_tries=6)
        self.assertEqual(result["outcome"], f"stopped: code crashed or timed out {agent.MAX_CODE_FAILURES} times")

    def test_next_try_starts_from_the_best_script(self):
        replies = ["```python\nprint('best')\n```", "```python\nprint('worse')\n```", "```python\nprint('next')\n```"]
        self.run_loop(replies, [[("clearance", 0.01)], [("clearance", 0.02), ("held", 1)], []], max_tries=6)
        self.assertIn("print('best')", self.prompts[2])
        self.assertNotIn("print('worse')", self.prompts[2])

    def test_a_passing_holder_moves_on_to_the_case(self):
        for outcome in ("pass", "pass_with_warnings", "passed"):
            stages = []

            def fake_part(_brief, folder, *_args, **kwargs):
                stages.append(kwargs.get("stage", "carrier"))
                Path(folder, "try-1").mkdir(parents=True, exist_ok=True)
                Path(folder, "try-1", "design.py").write_text("print(1)", encoding="utf-8")
                return {"outcome": outcome, "tries": 1}
            with mock.patch.object(agent, "design_part", fake_part), mock.patch.object(agent, "carrier_brief", lambda _p: "brief"), mock.patch.object(agent, "case_brief", lambda *_a: "brief"), mock.patch.object(agent, "HERE", self.folder):
                agent.design_case("part", "look", f"run-{outcome}")
            self.assertEqual(stages, ["carrier", "case"])

    def test_the_screen_can_be_a_separate_part(self):
        import body_stage
        base = {"parts": "seeed-xiao-esp32s3,ssd1309-242-oled,ky-040-rotary-encoder", "width_to_height": [1.6, 2.6]}
        limits = body_stage.screen_limits(base)
        self.assertAlmostEqual(limits["screen_width"], 55.02, places=1)
        self.assertAlmostEqual(limits["screen_height"], 27.49, places=1)

    def test_the_carrier_brief_uses_the_boards_own_front(self):
        brief = agent.carrier_brief("seeed-xiao-esp32s3")
        self.assertIn("from its front (+y)", brief)
        self.assertIn("coming back out toward +y", brief)
        self.assertIn("the closed case must still stop it", brief)

    def test_a_short_model_outage_is_retried(self):
        answers = [urllib.error.HTTPError("u", 520, "none", None, None), urllib.error.URLError("dropped"), io.BytesIO(b'{"ok": 1}')]

        def fake_open(_request, timeout=0):
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer
        with mock.patch("urllib.request.urlopen", fake_open), mock.patch.object(agent.time, "sleep", lambda _s: None):
            self.assertEqual(agent.send_with_retries("request"), {"ok": 1})

    def test_a_server_outage_waits_longer_each_time_then_gives_up(self):
        timeouts, waits = [], []

        def fake_open(_request, timeout=0):
            timeouts.append(timeout)
            raise urllib.error.HTTPError("u", 503, "down", None, None)
        with mock.patch("urllib.request.urlopen", fake_open), mock.patch.object(agent.time, "sleep", waits.append):
            with self.assertRaises(urllib.error.HTTPError):
                agent.send_with_retries("request")
        self.assertEqual(waits, [15, 30, 60])
        self.assertEqual(timeouts, [420] * 4)

    def test_a_timed_out_request_is_retried_only_once(self):
        # It may already be billed, and two waits of 420 s are enough to say the provider is stuck.
        calls, waits = [], []

        def fake_open(_request, timeout=0):
            calls.append(1)
            raise TimeoutError("read timed out")
        with mock.patch("urllib.request.urlopen", fake_open), mock.patch.object(agent.time, "sleep", waits.append):
            with self.assertRaises(TimeoutError):
                agent.send_with_retries("request")
        self.assertEqual(len(calls), 2)

    def test_files_left_by_an_earlier_run_are_gone_before_the_checks(self):
        # Same job name run twice: the new code writes nothing, so nothing from the first run may be checked.
        old = self.folder / "try-1"
        old.mkdir()
        (old / "PRINT_Shell.stl").write_text("from the earlier run")
        seen = []

        def check_design(folder, _stage="carrier"):
            seen.append(sorted(p.name for p in Path(folder).iterdir()))
            return {"passed": True, "failed": [], "results": []}
        with mock.patch.object(agent, "ask_model", lambda _i, _t: ("```python\nprint(1)\n```", {"total_tokens": 1})), mock.patch.object(agent.checks, "check_design", check_design):
            agent.design_part("brief", self.folder, 1)
        self.assertNotIn("PRINT_Shell.stl", seen[0])

    def test_a_bad_request_is_not_retried(self):
        calls = []

        def fake_open(_request, timeout=0):
            calls.append(1)
            raise urllib.error.HTTPError("u", 400, "bad", None, None)
        with mock.patch("urllib.request.urlopen", fake_open), mock.patch.object(agent.time, "sleep", lambda _s: None):
            with self.assertRaises(urllib.error.HTTPError):
                agent.send_with_retries("request")
        self.assertEqual(len(calls), 1)

    def test_every_try_is_saved(self):
        self.run_loop(["```python\nprint(1)\n```"] * 2, [[("clearance", 0.02)], []])
        for name in ("try-1", "try-2"):
            for file in ("prompt.txt", "design.py", "report.json"):
                self.assertTrue((self.folder / name / file).exists(), f"{name}/{file}")
        self.assertTrue((self.folder / "summary.json").exists())


if __name__ == "__main__":
    unittest.main()
