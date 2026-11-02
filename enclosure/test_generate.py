"""Tests for automatic retry and the customer result, with the generator faked. No AI. Run: .venv/Scripts/python -W ignore -m unittest test_generate"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import generate


def fake(outcomes):
    calls = []

    def design_case(base, look, run):
        calls.append(run)
        outcome = outcomes[len(calls) - 1]
        history = [{"ran": True, "failed": ["assembly", "screw_grip"]}] if outcome.startswith("stopped: same") else []
        return {"outcome": outcome, "tokens": 50_000, "seconds": 300, "tries": 3, "best_try": 3, "history": history}
    return design_case, calls


class Retry(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(generate.agent, "HERE", Path(self.folder.name))
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.folder.cleanup()

    def test_a_pass_on_the_first_try_is_not_retried(self):
        design_case, calls = fake(["pass_with_warnings"])
        record = generate.generate("x.json", "job", design_case=design_case)
        self.assertEqual(calls, ["job"])
        self.assertEqual(record["status"], "PASS WITH WARNINGS")
        self.assertIn("print checklist", record["message"])

    def test_a_failure_is_retried_and_the_retry_can_pass(self):
        design_case, calls = fake(["stopped: same failure twice", "pass"])
        record = generate.generate("x.json", "job", design_case=design_case)
        self.assertEqual(calls, ["job", "job-retry1"])
        self.assertEqual(record["status"], "PASS")
        self.assertEqual(record["model"], "runs/agent/job-retry1/case/try-3")
        self.assertEqual(record["tokens"], 100_000)

    def test_parts_that_cannot_fit_are_not_retried(self):
        design_case, calls = fake(["stopped: parts do not fit: the parts need 70 mm of width and the screen-size rule allows 69 mm"])
        record = generate.generate("x.json", "job", design_case=design_case)
        self.assertEqual(len(calls), 1)
        self.assertEqual(record["status"], "FAIL")
        self.assertIn("70 mm of width", record["message"])

    def test_two_failures_give_no_model_and_a_plain_reason(self):
        design_case, calls = fake(["stopped: same failure twice", "stopped: same failure twice"])
        record = generate.generate("x.json", "job", design_case=design_case)
        self.assertEqual(len(calls), 2)
        self.assertIsNone(record["model"])
        self.assertIn("parts collide on the way in", record["message"])
        self.assertIn("tried 2 times", record["message"])

    def test_progress_is_written_while_it_runs(self):
        target = Path(self.folder.name) / "runs" / "jobs" / "job.progress.json"
        design_case, _ = fake(["pass"])
        with mock.patch.dict(generate.agent.os.environ, {"ENCLOSURE_PROGRESS_PATH": str(target)}):
            generate.generate("x.json", "job", design_case=design_case)
        import json
        self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["stage"], "done")

    def test_without_a_picture_the_call_is_unchanged(self):
        seen = []
        generate.generate("x.json", "job", design_case=lambda *a, **k: seen.append((a, k)) or {"outcome": "pass", "tries": 1})
        self.assertEqual(seen, [(("x.json", None, "job"), {})])

    def test_a_chosen_picture_is_passed_to_every_attempt(self):
        picture = Path(self.folder.name) / "chosen.png"
        picture.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 100)
        seen = []
        outcomes = iter(["stopped: max tries", "pass"])
        generate.generate("x.json", "job", picture=str(picture), design_case=lambda *a, **k: seen.append(k.get("picture")) or {"outcome": next(outcomes), "tries": 1})
        self.assertEqual(seen, [str(picture), str(picture)])

    def test_a_picture_that_is_not_an_image_fails_before_any_ai_call(self):
        bad = Path(self.folder.name) / "bad.png"
        bad.write_bytes(b"not an image")
        calls = []
        record = generate.generate("x.json", "job", picture=str(bad), design_case=lambda *a, **k: calls.append(1))
        self.assertEqual(calls, [])
        self.assertEqual(record["status"], "FAIL")
        self.assertIn("picture", record["message"])
        missing = generate.generate("x.json", "job2", picture=str(Path(self.folder.name) / "gone.png"), design_case=lambda *a, **k: calls.append(1))
        self.assertEqual((calls, missing["status"]), ([], "FAIL"))

    def test_the_result_is_saved(self):
        design_case, _ = fake(["pass"])
        generate.generate("x.json", "job", design_case=design_case)
        self.assertTrue((Path(self.folder.name) / "runs" / "jobs" / "job.json").exists())


if __name__ == "__main__":
    unittest.main()
