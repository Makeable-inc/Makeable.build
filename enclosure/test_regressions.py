"""Scripts that once broke a shared building block (kept from real runs): each must build now.
Run: .venv/Scripts/python -W ignore -m unittest test_regressions"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent


class Regressions(unittest.TestCase):
    def test_every_kept_script_builds(self):
        scripts = sorted((HERE / "regressions").glob("*.py"))
        self.assertTrue(scripts)
        for script in scripts:
            with self.subTest(script=script.name), tempfile.TemporaryDirectory() as tmp:
                shutil.copy(HERE / "body_parts.py", Path(tmp) / "body_parts.py")
                shutil.copy(script, Path(tmp) / "design.py")
                done = subprocess.run([sys.executable, "-W", "ignore", "design.py"], cwd=tmp, capture_output=True, text=True, timeout=600)
                self.assertEqual(done.returncode, 0, done.stderr[-1500:])


if __name__ == "__main__":
    unittest.main()
