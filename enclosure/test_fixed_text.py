"""The fixed text the agents read (guides, worked examples, system prompts, tool descriptions, rubrics, building-block
docs) never names a held-back test design, so a better score on those designs is not the guide teaching the answer.
The design brief itself may name the design: it is not checked here.
Run: .venv/Scripts/python -W ignore -m unittest test_fixed_text"""
import re
import unittest
from pathlib import Path

HERE = Path(__file__).parent
# The held-back test designs (runs/unseen/FROZEN.md). Add the sealed set's names here when it is picked.
TEST_DESIGNS = ("frog", "whale", "rocket")


def fixed_text():
    """Every file whose text reaches an agent or a reviewer unchanged by the design."""
    files = list((HERE / "guides").glob("*.md")) + list((HERE / "body_examples").glob("*.py"))
    files += [p for p in HERE.glob("*.py") if not p.name.startswith("test_")]
    files += [p for p in (HERE / "DESIGN_RULES.md",) if p.exists()]
    return files


class FixedText(unittest.TestCase):
    def test_no_held_back_design_is_named(self):
        pattern = re.compile(r"\b(" + "|".join(TEST_DESIGNS) + r")s?\b", re.I)
        found = []
        for path in fixed_text():
            for number, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                if pattern.search(line):
                    found.append(f"{path.relative_to(HERE)}:{number}: {line.strip()[:100]}")
        self.assertEqual(found, [], "held-back test designs named in fixed text:\n" + "\n".join(found))

    def test_the_check_would_catch_a_name(self):
        pattern = re.compile(r"\b(" + "|".join(TEST_DESIGNS) + r")s?\b", re.I)
        self.assertTrue(pattern.search("superblob for a rounded body (an egg, a pebble, a frog)"))
        self.assertFalse(pattern.search("one sealed solid on the floor"))


if __name__ == "__main__":
    unittest.main()
