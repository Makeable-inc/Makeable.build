"""Stop rule tests with a fake AI, so the loop can be tested for free. Run: .venv/Scripts/python -W ignore -m unittest test_agent"""
import io
import json
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

    def test_every_try_leaves_one_trace_line_with_why_it_failed(self):
        # A cloud job must be explainable afterwards: stage, try, tokens, failed checks, crash text. It only records.
        replies = iter([CRASHES, "```python\nprint(1)\n```", "```python\nprint(2)\n```"])
        failed = {"passed": False, "failed": [{"check": "clearance", "part": "PRINT_Shell", "measured": 0.01, "limit": "limit", "where": [1, 2, 3], "fix": "fix it", "ok": False}], "results": []}
        reports = iter([failed, failed])

        def fake_model(_i, _t):
            return next(replies), {"total_tokens": 1200}
        with mock.patch.object(agent, "ask_model", fake_model), mock.patch.object(agent.checks, "check_design", lambda _f, _s="carrier": next(reports)):
            agent.design_part("brief", self.folder / "case", 2)
        lines = [json.loads(l) for l in (self.folder / "case" / "trace.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual([(l["stage"], l["try"], l["ran"]) for l in lines], [("carrier", 1, False), ("carrier", 2, True), ("carrier", 3, True)], "one line per AI call")
        self.assertIn("boom", lines[0]["crash"])
        self.assertEqual(lines[1]["failed"], ["clearance"])
        self.assertEqual(lines[1]["tokens"], 1200)
        self.assertNotIn("reasoning", lines[1])

    def test_a_long_crash_keeps_its_last_lines_where_the_error_is(self):
        noisy = "```python\nraise ValueError('y' * 6000 + ' the real error')\n```"
        replies = iter([noisy, noisy])
        with mock.patch.object(agent, "ask_model", lambda _i, _t: (next(replies), {"total_tokens": 1})):
            agent.design_part("brief", self.folder / "case", 1)
        crash = json.loads((self.folder / "case" / "trace.jsonl").read_text(encoding="utf-8").splitlines()[0])["crash"]
        self.assertIn("the real error", crash)
        self.assertLessEqual(len(crash), agent.TRACE_TEXT_LIMIT)

    def test_the_model_call_is_unchanged_by_tracing(self):
        sent = []

        def fake_open(request, timeout=0):
            sent.append(json.loads(request.data))
            return io.BytesIO(json.dumps({"output": [{"type": "reasoning", "summary": [{"type": "summary_text", "text": "Checked the gap."}]},
                                                     {"type": "message", "content": [{"text": "done"}]}], "usage": {"total_tokens": 9}}).encode())
        with mock.patch("urllib.request.urlopen", fake_open), mock.patch.object(agent, "api_key", lambda: "test"):
            reply, usage = agent.ask_model("system", "text")
        # Tracing only records what happened; it never asks the model for anything extra.
        self.assertEqual(sent[0]["reasoning"], {"effort": "medium"})
        self.assertEqual((reply, usage), ("done", {"total_tokens": 9}))

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


class ChosenPicture(unittest.TestCase):
    def run_case(self, picture):
        base = Path(tempfile.mkdtemp()) / "base.json"
        base.write_text('{"name": "n", "parts": "a,b", "look": "l", "picture_prompt": "p", "use_library": true}', encoding="utf-8")
        with mock.patch("concepts.base_picture", return_value=Path("generated.png")) as made, \
                mock.patch("body_stage.screen_limits", return_value={}), mock.patch("part_data.required_space", return_value={}), \
                mock.patch("part_data.space_conflict", return_value=None), mock.patch.object(agent, "design_with_library", return_value={"outcome": "pass"}) as design:
            agent.design_case(str(base), None, "run-picture", picture=picture)
        return made.call_count, design.call_args.args[2]

    def test_without_a_chosen_picture_one_is_generated_as_before(self):
        self.assertEqual(self.run_case(None), (1, Path("generated.png")))

    def test_a_chosen_picture_is_used_and_none_is_generated(self):
        self.assertEqual(self.run_case("chosen.png"), (0, Path("chosen.png")))


class LibraryTotals(unittest.TestCase):
    def test_the_body_stage_counts_toward_tokens_and_time(self):
        body = ("code", Path("BODY.stl"), {"best_score": 1, "tokens": 20000, "seconds": 200.0})
        case = {"outcome": "pass", "tries": 1, "best_try": 1, "tokens": 30000, "seconds": 300.0}
        with mock.patch("body_stage.design_body", return_value=body), mock.patch("body_stage.frozen_body_brief", return_value="frozen"), \
                mock.patch("library_brief.library_brief", return_value="brief"), mock.patch("part_data.required_space", return_value={}), \
                mock.patch.object(agent, "base_brief", return_value="base"), mock.patch.object(agent, "design_part", return_value=dict(case)):
            result = agent.design_with_library({}, [], None, Path(tempfile.mkdtemp()))
        self.assertEqual(result["tokens"], 50000)
        self.assertEqual(result["seconds"], 500.0)
        self.assertEqual(result["body_tokens"], 20000)


if __name__ == "__main__":
    unittest.main()
