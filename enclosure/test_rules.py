"""Runs every code block in DESIGN_RULES.md in order, so the rules cannot teach a call that does not work. Run: .venv/Scripts/python -W ignore -m unittest test_rules"""
import os
import re
import tempfile
import unittest
from pathlib import Path

RULES = Path(__file__).resolve().parent / "DESIGN_RULES.md"


class Rules(unittest.TestCase):
    def test_every_example_runs(self):
        blocks = re.findall(r"```python\n(.*?)```", RULES.read_text(encoding="utf-8"), re.S)
        self.assertGreaterEqual(len(blocks), 5)
        namespace = {}
        before = os.getcwd()
        with tempfile.TemporaryDirectory() as folder:
            os.chdir(folder)
            try:
                for block in blocks:
                    exec(block, namespace)
            finally:
                os.chdir(before)


if __name__ == "__main__":
    unittest.main()
