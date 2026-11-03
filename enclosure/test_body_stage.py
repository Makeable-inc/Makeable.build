"""The body stage loop with a fake AI, so it costs nothing. Run: .venv/Scripts/python -W ignore -m unittest test_body_stage"""
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
            return body_stage.design_body({}, "concept.png", self.folder)

    def test_a_body_left_by_an_earlier_run_is_not_taken_as_new(self):
        # Same job name run twice: the new script writes no body, so the old one must not be loaded as if it did.
        old = self.folder / "try-1"
        old.mkdir()
        (old / "BODY.stl").write_text("from the earlier run")
        (old / "BODY.step").write_text("from the earlier run")
        code, stl, summary = self.run_body([WRITES_NOTHING] * body_stage.MAX_BODY_CRASHES)
        self.assertIsNone(stl)
        self.assertIsNone(summary["best_score"])


if __name__ == "__main__":
    unittest.main()
