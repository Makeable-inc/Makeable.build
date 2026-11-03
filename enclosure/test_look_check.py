"""The look check only reports, so no reply from the reviewer may end a run. Run: .venv/Scripts/python -W ignore -m unittest test_look_check"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import look_check


def reply(text, tokens=900):
    return {"output": [{"type": "message", "content": [{"text": text}]}], "usage": {"total_tokens": tokens}}


class LookCheck(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        (self.folder / "preview.png").write_bytes(b"\x89PNG")
        self.picture = self.folder / "concept.png"
        self.picture.write_bytes(b"\x89PNG")

    def check(self, text):
        with mock.patch.object(look_check, "send_with_retries", lambda _r: reply(text)), mock.patch.object(look_check, "api_key", lambda: "test"):
            return look_check.look_check(self.picture, self.folder)

    def test_a_clear_reply_gives_its_score(self):
        found = self.check('{"score": 7, "differences": ["softer edges"]}')
        self.assertEqual((found["score"], found["differences"], found["tokens"]), (7, ["softer edges"], 900))

    def test_a_reply_with_two_objects_gives_no_score_and_does_not_crash(self):
        found = self.check('Here is my view {"score": 7, "differences": []} and also {note}')
        self.assertIsNone(found["score"])
        self.assertEqual(found["tokens"], 900)

    def test_broken_json_gives_no_score_and_does_not_crash(self):
        found = self.check('{"score": 7, "differences": ["a",')
        self.assertIsNone(found["score"])
        self.assertIn("unreadable_reply", json.loads((self.folder / "look.json").read_text()))


if __name__ == "__main__":
    unittest.main()
