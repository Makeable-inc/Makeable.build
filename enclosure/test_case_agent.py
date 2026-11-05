"""The case agent's loop with a fake model and fake tools (costs nothing).
Run: .venv/Scripts/python -W ignore -m unittest test_case_agent"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import case_agent


def reply(*calls, said=""):
    output = [{"type": "function_call", "name": n, "call_id": f"c{i}", "arguments": json.dumps(a)} for i, (n, a) in enumerate(calls)]
    if said:
        output.append({"type": "message", "content": [{"text": said}]})
    return {"id": "r", "output": output, "usage": {"total_tokens": 10}}


class FakeShop:
    """Submits pass with the given look scores, in order."""

    def __init__(self, scores, folder):
        self.scores, self.submits, self.best, self.calls = list(scores), 0, None, []
        self.folder = Path(folder)

    def execute(self, name, arguments):
        self.calls.append(name)
        if name == "submit":
            self.submits += 1
            score = self.scores.pop(0)
            snapshot = self.folder / f"submit-{self.submits}"
            snapshot.mkdir(parents=True, exist_ok=True)
            if self.best is None or score > self.best["score"]:
                self.best = {"score": score, "code": "x", "folder": snapshot, "status": "pass"}
            return json.dumps({"passed": True, "look_score": score}), None
        return "ok", None


class Loop(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name)
        from PIL import Image
        self.picture = self.folder / "concept.png"
        Image.new("RGB", (8, 8), "white").save(self.picture)

    def run_agent(self, replies, scores):
        shop = FakeShop(scores, self.folder)
        replies = iter(replies)
        with mock.patch.object(case_agent, "call", lambda _b, previous=None: next(replies)), \
                mock.patch.object(case_agent, "Workshop", lambda *a, **k: shop):
            summary = case_agent.design_case("brief", self.folder, {"style": "character"}, "BODY.stl", self.picture, [], "system")
        return summary, shop

    def test_a_pass_under_the_look_target_gets_polish_and_keeps_the_best(self):
        replies = [reply(("run", {"code": "a"}), ("check", {"group": "fit"})), reply(("submit", {})),
                   reply(("run", {"code": "b"}), ("submit", {})), reply(("submit", {}))]
        summary, shop = self.run_agent(replies, [6, 5, 8])
        self.assertEqual(summary["submits"], 3)
        self.assertEqual(summary["look_score"], 8)
        self.assertTrue((self.folder / "best").exists())
        steps = [json.loads(line) for line in (self.folder / "steps.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual([s["tool"] for s in steps if "tool" in s], ["run", "check", "submit", "run", "submit", "submit"])

    def test_it_stops_when_the_agent_stops_calling_tools(self):
        summary, _ = self.run_agent([reply(("run", {"code": "a"})), reply(said="done")], [])
        self.assertIn("stopped calling tools", summary["outcome"])
        self.assertIsNone(summary["best"])

    def test_the_submit_budget_ends_the_run_with_the_best_kept(self):
        replies = [reply(("submit", {}))] * case_agent.MAX_SUBMITS
        summary, _ = self.run_agent(replies, [5, 6, 4, 5])
        self.assertEqual(summary["submits"], case_agent.MAX_SUBMITS)
        self.assertEqual(summary["look_score"], 6)


if __name__ == "__main__":
    unittest.main()
