"""Tests for how AI-written code is run. Run: .venv/Scripts/python -W ignore -m unittest test_sandbox"""
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import sandbox

CODE = "import math\nprint(math.pi)\n"


def finished(*_args, **_kwargs):
    return subprocess.CompletedProcess([], 0, "", "")


class RunnerUser(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())

    def test_without_a_runner_user_the_code_runs_as_before(self):
        with mock.patch.dict(sandbox.os.environ, {}, clear=False), mock.patch.object(sandbox.subprocess, "run", side_effect=finished) as run:
            sandbox.os.environ.pop("ENCLOSURE_RUNNER_USER", None)
            self.assertEqual(sandbox.run_design(CODE, self.folder), (True, ""))
        self.assertNotIn("user", run.call_args.kwargs)

    def test_in_the_container_the_code_runs_as_the_runner_user_who_owns_the_folder(self):
        account = types.SimpleNamespace(pw_uid=999, pw_gid=998)
        with mock.patch.dict(sandbox.os.environ, {"ENCLOSURE_RUNNER_USER": "runner"}), \
                mock.patch.object(sandbox.os, "geteuid", return_value=0, create=True), \
                mock.patch.object(sandbox, "runner_account", return_value=account), \
                mock.patch.object(sandbox.os, "chown", create=True) as chown, \
                mock.patch.object(sandbox.subprocess, "run", side_effect=finished) as run:
            self.assertEqual(sandbox.run_design(CODE, self.folder), (True, ""))
        self.assertEqual((run.call_args.kwargs["user"], run.call_args.kwargs["group"]), (999, 998))
        self.assertEqual(run.call_args.kwargs["extra_groups"], [])
        chown.assert_any_call(self.folder.resolve(), 999, 998)

    def test_a_runner_user_is_required_to_be_root_to_switch(self):
        with mock.patch.dict(sandbox.os.environ, {"ENCLOSURE_RUNNER_USER": "runner"}), \
                mock.patch.object(sandbox.os, "geteuid", return_value=1000, create=True), \
                mock.patch.object(sandbox.subprocess, "run", side_effect=finished) as run:
            ok, message = sandbox.run_design(CODE, self.folder)
        self.assertFalse(ok)
        self.assertIn("runner user", message)
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
