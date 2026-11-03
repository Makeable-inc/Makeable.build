"""Tests for the cloud wrapper: picture in, progress and result out, with S3 and the generator faked. Run: .venv/Scripts/python -W ignore -m unittest test_cloud_run"""
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import cloud_run


class FakeS3:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.order = []

    def put_object(self, Bucket, Key, Body, **_):
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.encode()
        self.order.append(Key)

    def download_file(self, Bucket, Key, Filename):
        Path(Filename).write_bytes(self.objects[Key])


PREFIX = "makeable-enclosure-runs/enc-aaaaaaaaaaaa/"


class CloudRun(unittest.TestCase):
    def setUp(self):
        self.here = Path(tempfile.mkdtemp())
        patcher = mock.patch.object(cloud_run, "HERE", self.here)
        patcher.start()
        self.addCleanup(patcher.stop)

    def passing_generate(self, picture_seen):
        def generate(base, job, picture=None):
            picture_seen.append(picture)
            folder = self.here / "runs" / "agent" / job / "case" / "try-1"
            folder.mkdir(parents=True)
            for name in cloud_run.FILES:
                (folder / name).write_bytes(b"x")
            return {"status": "PASS", "model": f"runs/agent/{job}/case/try-1", "tokens": 1, "seconds": 1, "attempts": []}
        return generate

    def test_files_are_uploaded_before_the_result(self):
        s3, seen = FakeS3(), []
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, generate=self.passing_generate(seen))
        files = [PREFIX + "files/" + name for name in cloud_run.FILES]
        self.assertEqual(s3.order[-1], PREFIX + "result.json")
        self.assertTrue(all(s3.order.index(f) < s3.order.index(PREFIX + "result.json") for f in files))
        self.assertEqual(json.loads(s3.objects[PREFIX + "result.json"])["status"], "PASS")
        self.assertEqual(seen, [None])

    def test_a_chosen_picture_is_downloaded_and_passed_on(self):
        s3, seen = FakeS3({"makeable-enclosure-pictures/pic-aaaaaaaaaaaa.png": b"\x89PNG"}), []
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, picture_key="makeable-enclosure-pictures/pic-aaaaaaaaaaaa.png", generate=self.passing_generate(seen))
        self.assertEqual(Path(seen[0]).read_bytes(), b"\x89PNG")

    def test_a_crash_still_writes_a_plain_failure(self):
        s3 = FakeS3()
        def crash(*_a, **_k):
            raise RuntimeError("boom in the kernel")
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, generate=crash)
        result = json.loads(s3.objects[PREFIX + "result.json"])
        self.assertEqual(result["status"], "FAIL")
        self.assertNotIn("boom", result["message"])

    def test_a_picture_that_cannot_be_fetched_still_writes_a_plain_failure_and_runs_nothing(self):
        s3, calls = FakeS3(), []
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, picture_key="makeable-enclosure-pictures/gone.png", generate=lambda *a, **k: calls.append(1))
        result = json.loads(s3.objects[PREFIX + "result.json"])
        self.assertEqual((result["status"], calls), ("FAIL", []))
        self.assertIn("picture", result["message"])

    def test_a_run_past_its_deadline_writes_a_plain_failure_and_ends_the_task(self):
        # Fargate has no time limit of its own, so the task enforces one; the API's cleanup relies on tasks ending.
        s3, exits, done = FakeS3(), [], threading.Event()

        def slow(*_a, **_k):
            done.wait(5)
            return {"status": "PASS", "model": None, "tokens": 1, "seconds": 1, "attempts": []}

        def exit_task(code):
            exits.append(code)
            done.set()
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, generate=slow, deadline_seconds=0.2, exit_task=exit_task)
        result = json.loads(s3.objects[PREFIX + "result.json"])
        self.assertEqual((result["status"], exits), ("FAIL", [1]))
        self.assertIn("too long", result["message"])

    def test_progress_is_uploaded_when_it_changes(self):
        s3 = FakeS3()
        progress = self.here / "runs" / "jobs" / "enc-aaaaaaaaaaaa.progress.json"
        progress.parent.mkdir(parents=True)
        uploader = cloud_run.ProgressUploader(s3, "b", PREFIX, progress)
        uploader.push()
        self.assertNotIn(PREFIX + "progress.json", s3.objects)
        progress.write_text('{"stage": "body"}')
        uploader.push()
        uploader.push()
        self.assertEqual(s3.order.count(PREFIX + "progress.json"), 1)


if __name__ == "__main__":
    unittest.main()
