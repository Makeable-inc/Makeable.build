"""Tests for the cloud wrapper: picture in, progress and result out, with S3 and the generator faked. Run: .venv/Scripts/python -W ignore -m unittest test_cloud_run"""
import io
import json
import tempfile
import threading
import unittest
import zipfile
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

    def zip_names(self, s3):
        return sorted(zipfile.ZipFile(io.BytesIO(s3.objects[PREFIX + "run.zip"])).namelist())

    def test_the_whole_run_folder_is_zipped_and_uploaded_before_the_result(self):
        s3 = FakeS3()
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, generate=self.passing_generate([]))
        self.assertLess(s3.order.index(PREFIX + "run.zip"), s3.order.index(PREFIX + "result.json"))
        self.assertIn("agent/enc-aaaaaaaaaaaa/case/try-1/design.json", self.zip_names(s3))

    def test_a_failed_run_and_its_retry_are_zipped_too(self):
        s3 = FakeS3()

        def crash(base, job, picture=None):
            for run in (job, f"{job}-retry1"):
                folder = self.here / "runs" / "agent" / run / "case"
                folder.mkdir(parents=True)
                (folder / "trace.jsonl").write_text('{"stage": "case", "try": 1, "crash": "boom"}\\n')
            raise RuntimeError("boom")
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, generate=crash)
        names = self.zip_names(s3)
        self.assertIn("agent/enc-aaaaaaaaaaaa/case/trace.jsonl", names)
        self.assertIn("agent/enc-aaaaaaaaaaaa-retry1/case/trace.jsonl", names)
        self.assertEqual(json.loads(s3.objects[PREFIX + "result.json"])["status"], "FAIL")

    def test_a_zip_that_cannot_be_sent_never_stops_the_result(self):
        s3 = FakeS3()
        put = s3.put_object

        def put_object(Bucket, Key, Body, **kw):
            if Key.endswith("run.zip"):
                raise RuntimeError("S3 refused")
            put(Bucket=Bucket, Key=Key, Body=Body, **kw)
        s3.put_object = put_object
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, generate=self.passing_generate([]))
        self.assertEqual(json.loads(s3.objects[PREFIX + "result.json"])["status"], "PASS")

    def test_a_file_that_vanishes_while_zipping_is_skipped_and_the_rest_is_kept(self):
        folder = self.here / "runs" / "agent" / "enc-aaaaaaaaaaaa" / "case" / "try-1"
        folder.mkdir(parents=True)
        for name in ("design.py", "report.json", "PRINT_Shell.stl"):
            (folder / name).write_text(name)
        real_write = zipfile.ZipFile.write

        def vanishing_write(zf, path, *a, **k):
            # The generator deletes this one just as it is being packed.
            if str(path).endswith("PRINT_Shell.stl"):
                Path(path).unlink()
            return real_write(zf, path, *a, **k)
        with mock.patch.object(zipfile.ZipFile, "write", vanishing_write):
            names = zipfile.ZipFile(io.BytesIO(cloud_run.zip_run("enc-aaaaaaaaaaaa"))).namelist()
        self.assertIn("agent/enc-aaaaaaaaaaaa/case/try-1/design.py", names)
        self.assertNotIn("agent/enc-aaaaaaaaaaaa/case/try-1/PRINT_Shell.stl", names)

    def test_past_the_deadline_the_user_is_told_first_then_the_run_is_zipped(self):
        s3, exits, done = FakeS3(), [], threading.Event()

        def busy(base, job, picture=None):
            # Still writing and deleting try folders when the deadline comes.
            n = 0
            while not done.is_set():
                n += 1
                folder = self.here / "runs" / "agent" / job / "case" / f"try-{n}"
                folder.mkdir(parents=True)
                (folder / "design.py").write_text("x")
                if n > 1:
                    import shutil
                    shutil.rmtree(self.here / "runs" / "agent" / job / "case" / f"try-{n - 1}", ignore_errors=True)
                done.wait(0.01)
            return {"status": "PASS", "model": None, "tokens": 1, "seconds": 1, "attempts": []}

        def exit_task(code):
            exits.append(code)
            done.set()
        cloud_run.run("base_designs/x.json", "enc-aaaaaaaaaaaa", s3=s3, bucket="b", prefix=PREFIX, generate=busy, deadline_seconds=0.3, exit_task=exit_task)
        self.assertEqual(exits, [1])
        self.assertEqual(json.loads(s3.objects[PREFIX + "result.json"])["status"], "FAIL")
        self.assertLess(s3.order.index(PREFIX + "result.json"), s3.order.index(PREFIX + "run.zip"), "the user's answer never waits on the trail")
        self.assertTrue(any(n.endswith("design.py") for n in self.zip_names(s3)))

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
