"""The shared harness with a fake model (costs nothing): long results are shortened with a reference the agent can
recall, every model call logs its tokens, and past the compaction limit a fresh chain starts from a handoff.
Run: .venv/Scripts/python -W ignore -m unittest test_harness"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import harness


def reply(*calls, said="", usage=None, rid="r"):
    output = [{"type": "function_call", "name": n, "call_id": f"c{i}", "arguments": json.dumps(a)} for i, (n, a) in enumerate(calls)]
    if said:
        output.append({"type": "message", "content": [{"text": said}]})
    return {"id": rid, "output": output, "usage": usage or {"input_tokens": 1000, "output_tokens": 50, "total_tokens": 1050,
                                                          "input_tokens_details": {"cached_tokens": 800}}}


class Shop:
    tools = []
    code = "print('the current file')"

    def __init__(self):
        self.submits, self.best, self.seen = 0, None, []

    def done(self):
        return self.best is not None

    def execute(self, name, arguments):
        if name == "check":
            return "x" * 5000, None
        if name == "submit":
            self.submits += 1
            self.best = {"score": 9, "folder": None, "status": "pass"}
            return "passed", None
        return "ok", None


CRASH = ("The code crashed:\nTraceback (most recent call last):\n"
         '  File "C:\\\\work\\\\design.py", line 6, in <module>\n    body = superblob(110, 62, 36.8, top=5)\n'
         + "  " + "x" * 3000 + "\n"
         + "RuntimeError: Failed to create valid loft")


class Crashing(Shop):
    def execute(self, name, arguments):
        if name == "build":
            return CRASH, None
        return super().execute(name, arguments)


class Harness(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)

    def run_with(self, replies):
        sent, replies = [], iter(replies)

        def fake(_tools, body, previous=None):
            sent.append((body, previous))
            return next(replies)
        with mock.patch.object(harness, "call", fake):
            outcome = harness.run(Shop(), "instructions", "brief", self.folder, None, 20, 4, "test")
        steps = [json.loads(line) for line in (self.folder / "steps.jsonl").read_text(encoding="utf-8").splitlines()]
        return outcome, sent, steps

    def test_a_long_result_is_shortened_and_can_be_recalled(self):
        outcome, sent, steps = self.run_with([reply(("check", {"group": "all"})), reply(("recall", {"ref": "r1"})), reply(("submit", {}))])
        short = sent[1][0]["input"][0]["output"]
        self.assertIn("recall('r1')", short)
        self.assertLess(len(short), 1400)
        self.assertEqual(len(sent[2][0]["input"][0]["output"]), 5000)
        self.assertEqual(outcome[0], "pass")

    def run_shop(self, shop, replies, max_steps=20):
        sent, replies = [], iter(replies)

        def fake(_tools, body, previous=None):
            sent.append((body, previous))
            return next(replies)
        with mock.patch.object(harness, "call", fake):
            outcome = harness.run(shop, "instructions", "brief", self.folder, None, max_steps, 4, "test")
        steps = [json.loads(line) for line in (self.folder / "steps.jsonl").read_text(encoding="utf-8").splitlines()]
        return outcome, sent, steps

    def test_a_crash_comes_back_whole_with_where_and_what_to_try(self):
        outcome, sent, _ = self.run_shop(Crashing(), [reply(("build", {})), reply(("submit", {}))])
        shown = json.loads(sent[1][0]["input"][0]["output"])
        self.assertFalse(shown["ok"])
        self.assertIn("Failed to create valid loft", shown["error"])
        self.assertIn("line 6", shown["at"])
        self.assertTrue(any("body_parts block" in t for t in shown["try"]))
        self.assertNotIn("recall(", sent[1][0]["input"][0]["output"], "a failure is never shortened")

    def test_the_same_failure_twice_is_flagged_and_not_counted(self):
        outcome, sent, steps = self.run_shop(Crashing(), [reply(("build", {})), reply(("build", {})), reply(("submit", {}))])
        second = json.loads(sent[2][0]["input"][0]["output"])
        self.assertIn("Same call, same file, same failure as step 1", second["error"])
        tools = [s for s in steps if "tool" in s]
        self.assertEqual([s["step"] for s in tools], [1, 1, 2], "the repeat costs no step")

    def test_looking_costs_no_build_step_until_its_own_limit(self):
        with mock.patch.object(harness, "MAX_INSPECTIONS", 2):
            outcome, sent, steps = self.run_shop(Shop(), [reply(("docs", {"name": "a"})), reply(("docs", {"name": "b"})),
                                                          reply(("docs", {"name": "c"})), reply(("submit", {}))])
        tools = [s for s in steps if "tool" in s]
        self.assertEqual([(s["step"], s["inspections"]) for s in tools], [(0, 1), (0, 2), (1, 2), (2, 2)])
        self.assertIn("Inspection limit reached", sent[3][0]["input"][0]["output"])

    def test_every_model_call_logs_its_tokens(self):
        _, _, steps = self.run_with([reply(("submit", {}))])
        model = [s for s in steps if "model" in s]
        self.assertEqual(len(model), 1)
        self.assertEqual((model[0]["input"], model[0]["cached"], model[0]["output"]), (1000, 800, 50))

    def test_past_the_limit_a_fresh_chain_starts_from_a_handoff(self):
        big = {"input_tokens": 50_000, "output_tokens": 10, "total_tokens": 50_010}
        replies = [reply(("check", {"group": "fit"}), usage=big), reply(said="facts: fits; next: submit", usage=big), reply(("submit", {}))]
        with mock.patch.object(harness, "COMPACT_AT", 40_000):
            outcome, sent, steps = self.run_with(replies)
        handoff_request, fresh = sent[1], sent[2]
        self.assertEqual(handoff_request[0]["tool_choice"], "none")
        self.assertIsNone(fresh[1], "a fresh chain has no previous response")
        texts = " ".join(c["text"] for c in fresh[0]["input"][0]["content"] if c["type"] == "input_text")
        self.assertIn("facts: fits; next: submit", texts)
        self.assertIn("the current file", texts)
        self.assertTrue(any(s.get("compacted") for s in steps))
        self.assertEqual(outcome[0], "pass")


class CostCount(unittest.TestCase):
    def test_cached_input_counts_at_a_tenth(self):
        import agent
        agent.start_job()
        agent.spend({"total_tokens": 10_000, "input_tokens_details": {"cached_tokens": 9_000}})
        self.assertEqual(agent.job_tokens(), 1_900)
        agent.spend(500)
        self.assertEqual(agent.job_tokens(), 2_400)



class Resume(unittest.TestCase):
    def test_a_crashed_run_continues_from_its_saved_step(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        folder = Path(tmp.name)

        class Keeping(Shop):
            def state(self):
                return {"submits": self.submits, "best": self.best}

            def restore(self, saved):
                self.submits, self.best = saved["submits"], saved["best"]

        first = iter([reply(("check", {"group": "fit"})), reply(("render", {}))])

        def crashing(_tools, body, previous=None):
            try:
                return next(first)
            except StopIteration:
                raise RuntimeError("the laptop went to sleep")
        with mock.patch.object(harness, "call", crashing), self.assertRaises(RuntimeError):
            harness.run(Keeping(), "instructions", "brief", folder, None, 20, 4, "test")
        saved = json.loads((folder / "state.json").read_text(encoding="utf-8"))
        self.assertEqual((saved["steps"], saved["inspections"]), (1, 1), "the check is a step; the render is a free look")

        sent, second = [], iter([reply(("submit", {}))])

        def fake(_tools, body, previous=None):
            sent.append((body, previous))
            return next(second)
        with mock.patch.object(harness, "call", fake):
            outcome = harness.run(Keeping(), "instructions", "brief", folder, None, 20, 4, "test", resume=True)
        opening = " ".join(c["text"] for c in sent[0][0]["input"][0]["content"] if c["type"] == "input_text")
        self.assertIn("resuming a run that stopped after step 1", opening)
        self.assertIn("the current file", opening)
        self.assertIsNone(sent[0][1])
        self.assertEqual(outcome[1], 2, "the step count carries on from the saved one")
        self.assertEqual(outcome[0], "pass")



class Labels(unittest.TestCase):
    def test_only_a_pass_at_the_target_is_done(self):
        self.assertEqual(harness.result_label({"score": 8}, 8), "done")
        self.assertEqual(harness.result_label({"score": 6}, 8), "draft: fits, look goal not met (6/10)")
        self.assertEqual(harness.result_label(None, 8), "failed")
        self.assertEqual(harness.result_label({"score": 0}, 8, reviewed=False), "done", "a plain design has no look goal")


if __name__ == "__main__":
    unittest.main()
