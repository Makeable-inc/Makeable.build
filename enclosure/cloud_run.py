"""Runs one enclosure job on AWS (a Fargate task): fetches the chosen picture, runs generate.py, and sends progress,
the files and the result to S3. The generator itself is unchanged; this only moves files in and out.

    python cloud_run.py base_designs/<design>.json <job>

Settings come from the task's environment, set by the API when it starts the task:
    ENCLOSURE_BUCKET        the data bucket
    ENCLOSURE_PREFIX        where this job's output goes, ending in /   (makeable-enclosure-runs/<job>/)
    ENCLOSURE_PICTURE_KEY   optional: the chosen picture's key in the bucket

Output, in this order, so a result is never seen before its files:
    <prefix>progress.json   while it runs, when it changes (at most every PROGRESS_SECONDS)
    <prefix>files/<name>    the files of a passed case
    <prefix>result.json     the job record, the same as runs/jobs/<job>.json locally
"""
import json
import os
import sys
import io
import threading
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The printable files, plus what rebuilds the 3D view with the real parts placed (design.json) and the view itself.
FILES = ("PRINT_Shell.stl", "PRINT_Base.stl", "preview.png", "report.json", "design.json", "viewer.html")
PROGRESS_SECONDS = 30
# Fargate tasks have no time limit of their own, so the task keeps one: it ends before the API's 60-minute limit,
# and the API frees a job's place only once AWS confirms the task stopped. The slowest real run so far took 31 minutes.
DEADLINE_SECONDS = int(os.environ.get("ENCLOSURE_MAX_SECONDS") or 55 * 60)
TYPES = {".stl": "model/stl", ".png": "image/png", ".json": "application/json", ".html": "text/html"}


class ProgressUploader:
    """Sends the progress file to S3 when it has changed since the last send."""

    def __init__(self, s3, bucket, prefix, path):
        self.s3, self.bucket, self.key, self.path, self.last = s3, bucket, prefix + "progress.json", Path(path), None

    def push(self):
        try:
            body = self.path.read_bytes()
        except OSError:
            return
        if body != self.last:
            self.s3.put_object(Bucket=self.bucket, Key=self.key, Body=body, ContentType="application/json")
            self.last = body


def zip_run(job):
    """The whole run folder, every try of every attempt (runs/agent/<job>*), and the job record, as one zip.
    Kept so a failed or stuck job on AWS can be explained afterwards. None if there is nothing to send."""
    runs = HERE / "runs"
    folders = [p for p in (runs / "agent").glob(f"{job}*") if p.is_dir() and (p.name == job or p.name.startswith(f"{job}-retry"))]
    extra = [p for p in ((runs / "jobs" / f"{job}.json"), (runs / "jobs" / f"{job}.progress.json")) if p.exists()]
    if not folders and not extra:
        return None
    # At the deadline the generator is still writing and deleting tries, so a file or folder can vanish mid-walk.
    # os.walk skips folders that are gone, and a file that is gone is left out: the rest of the trail still counts.
    def files():
        for folder in folders:
            for root, dirs, names in os.walk(folder):
                dirs[:] = sorted(d for d in dirs if d != "__pycache__")
                for name in sorted(names):
                    yield Path(root) / name
        yield from extra

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as out:
        for path in files():
            try:
                out.write(path, path.relative_to(runs).as_posix())
            except OSError:
                pass
    return buffer.getvalue()


def send_run_zip(s3, bucket, prefix, job):
    try:
        body = zip_run(job)
        if body:
            s3.put_object(Bucket=bucket, Key=prefix + "run.zip", Body=body, ContentType="application/zip")
    except Exception as error:  # the trail is for us; never let it stop the user's result
        print(f"run folder not sent: {error!r}", flush=True)


def log_peak_memory():
    """Peak memory of the generator and of its largest child (the AI's code), to size the task."""
    try:
        import resource
        own, child = (resource.getrusage(who).ru_maxrss / 1024 for who in (resource.RUSAGE_SELF, resource.RUSAGE_CHILDREN))
        print(f"peak memory: generator {own:.0f} MB, largest child {child:.0f} MB", flush=True)
    except (ImportError, AttributeError):
        pass


def run(base, job, s3, bucket, prefix, picture_key=None, generate=None, deadline_seconds=None, exit_task=os._exit):
    if generate is None:
        from generate import generate
    progress = HERE / "runs" / "jobs" / f"{job}.progress.json"
    os.environ["ENCLOSURE_PROGRESS_PATH"] = str(progress)
    uploader = ProgressUploader(s3, bucket, prefix, progress)
    stop = threading.Event()

    def keep_sending():
        while not stop.wait(PROGRESS_SECONDS):
            try:
                uploader.push()
            except Exception as error:  # progress is a nicety; never stop a run for it
                print(f"progress not sent: {error}", flush=True)

    sender = threading.Thread(target=keep_sending, daemon=True)
    sender.start()

    def failed(message):
        return {"job": job, "status": "FAIL", "model": None, "tokens": 0, "seconds": 0, "attempts": [], "message": f"No case was made. {message}"}

    # Past the deadline: write a plain failure and end the task, whatever the generator is doing.
    lock, state = threading.Lock(), {"finished": False, "timed_out": False}

    def on_deadline():
        with lock:
            if state["finished"]:
                return
            state["timed_out"] = True
        print("deadline reached, ending the task", flush=True)
        try:
            # The user's answer first: the trail must never delay or block it.
            s3.put_object(Bucket=bucket, Key=prefix + "result.json", ContentType="application/json",
                          Body=json.dumps(failed("This job took too long, so it was stopped. You can start it again.")).encode())
            send_run_zip(s3, bucket, prefix, job)
        finally:
            exit_task(1)

    deadline = threading.Timer(DEADLINE_SECONDS if deadline_seconds is None else deadline_seconds, on_deadline)
    deadline.daemon = True
    deadline.start()
    try:

        picture, record = None, None
        if picture_key:
            picture = HERE / "runs" / "pictures" / Path(picture_key).name
            picture.parent.mkdir(parents=True, exist_ok=True)
            try:
                s3.download_file(Bucket=bucket, Key=picture_key, Filename=str(picture))
            except Exception as error:
                # Before any paid call: without its picture the job must not run, and must still answer.
                print(f"picture not fetched: {error!r}", flush=True)
                record = failed("The chosen picture could not be loaded. You can start it again.")
        if record is None:
            try:
                record = generate(base, job, picture=str(picture) if picture else None)
            except Exception as error:
                print(f"generator crashed: {error!r}", flush=True)
                record = failed("The case maker hit an error. You can start it again.")
        with lock:
            if state["timed_out"]:
                return None
            state["finished"] = True
        if record.get("model"):
            folder = HERE / record["model"]
            for name in FILES:
                path = folder / name
                if path.exists():
                    s3.put_object(Bucket=bucket, Key=f"{prefix}files/{name}", Body=path.read_bytes(), ContentType=TYPES[path.suffix])
        send_run_zip(s3, bucket, prefix, job)
        s3.put_object(Bucket=bucket, Key=prefix + "result.json", Body=json.dumps(record).encode(), ContentType="application/json")
    finally:
        deadline.cancel()
        stop.set()
        log_peak_memory()
        try:
            uploader.push()
        except Exception as error:
            print(f"progress not sent: {error}", flush=True)
    return record


if __name__ == "__main__":
    import boto3

    run(sys.argv[1], sys.argv[2], s3=boto3.client("s3"), bucket=os.environ["ENCLOSURE_BUCKET"],
        prefix=os.environ["ENCLOSURE_PREFIX"], picture_key=os.environ.get("ENCLOSURE_PICTURE_KEY") or None)
