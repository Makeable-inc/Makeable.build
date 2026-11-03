"""The body stage loop with a fake AI, so it costs nothing. Run: .venv/Scripts/python -W ignore -m unittest test_body_stage"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import body_stage

WRITES_NOTHING = "```python\nprint(1)\n```"


class BodyLoop(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)

    def run_body(self, replies, tokens=100):
        replies = iter(replies)
        with mock.patch.object(body_stage.agent, "ask_model", lambda _i, _t, _p=None: (next(replies), {"total_tokens": tokens})), \
                mock.patch.object(body_stage, "body_brief", lambda _b: "brief"):
            return body_stage.design_body({}, "concept.png", self.folder / "body")

    def test_a_body_left_by_an_earlier_run_is_not_taken_as_new(self):
        # Same job name run twice: the new script writes no body, so the old one must not be loaded as if it did.
        old = self.folder / "body" / "try-1"
        old.mkdir(parents=True)
        (old / "BODY.stl").write_text("from the earlier run")
        (old / "BODY.step").write_text("from the earlier run")
        code, stl, summary = self.run_body([WRITES_NOTHING] * body_stage.MAX_BODY_CRASHES)
        self.assertIsNone(stl)
        self.assertIsNone(summary["best_score"])


class BodyTrace(unittest.TestCase):
    def test_every_body_try_leaves_a_trace_line(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        run = Path(temporary.name)
        replies = iter(["```python\nraise ValueError('no body here')\n```"] * body_stage.MAX_BODY_CRASHES)
        with mock.patch.object(body_stage.agent, "ask_model", lambda _i, _t, _p=None: (next(replies), {"total_tokens": 300, "reasoning_summary": "Tried a rounded box."})), \
                mock.patch.object(body_stage, "body_brief", lambda _b: "brief"):
            body_stage.design_body({}, "concept.png", run / "body")
        lines = [json.loads(l) for l in (run / "body" / "trace.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(lines), body_stage.MAX_BODY_CRASHES)
        self.assertEqual((lines[0]["stage"], lines[0]["try"], lines[0]["ran"]), ("body", 1, False))
        self.assertIn("no body here", lines[0]["crash"])
        self.assertEqual(lines[0]["reasoning"], "Tried a rounded box.")


if __name__ == "__main__":
    unittest.main()
