"""The agents' saved script: exact single edits, sectioned show, and snapshots that survive a broken edit.
Run: .venv/Scripts/python -W ignore -m unittest test_script_file"""
import tempfile
import unittest
from pathlib import Path

from script_file import ScriptFile

CODE = "width = 100\nheight = 50\nprint('size', width, height)\nprint('size', width, height)\n"


class Script(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.script = ScriptFile(Path(tmp.name) / "script.py")
        self.script.write(CODE)

    def test_an_exact_single_match_is_replaced(self):
        ok, message = self.script.edit("height = 50", "height = 62")
        self.assertTrue(ok, message)
        self.assertIn("height = 62", self.script.text)
        self.assertIn("line 2", message)

    def test_a_match_found_twice_changes_nothing(self):
        ok, message = self.script.edit("print('size', width, height)", "print('x')")
        self.assertFalse(ok)
        self.assertIn("2 times", message)
        self.assertEqual(self.script.text, CODE)

    def test_a_missing_match_changes_nothing(self):
        ok, message = self.script.edit("depth = 40", "depth = 44")
        self.assertFalse(ok)
        self.assertEqual(self.script.text, CODE)

    def test_show_gives_a_numbered_section_not_the_whole_file(self):
        self.script.write("\n".join(f"line_{i} = {i}" for i in range(1, 201)))
        shown = self.script.show(find="line_120 ")
        self.assertIn(" 120  line_120 = 120", shown)
        self.assertNotIn("line_1 = 1\n", shown)
        self.assertLessEqual(len(shown.splitlines()), 82)

    def test_a_snapshot_survives_a_later_broken_edit(self):
        kept = self.script.snapshot()
        self.script.edit("width = 100", "width = (")
        self.assertEqual(kept.read_text(encoding="utf-8"), CODE)
        self.assertIn("width = (", self.script.text)


if __name__ == "__main__":
    unittest.main()
