"""One customer request: run the generator, retry automatically when it fails, and give a plain result. A model is only returned when every must-pass check passed.

Run: .venv/Scripts/python -W ignore generate.py base_designs/<design>.json <job name>
"""
import json
import sys
from pathlib import Path

import agent

MAX_ATTEMPTS = 2
PASSING = {"pass", "passed", "pass_with_warnings"}
CHECK_NAMES = {
    "assembly": "parts collide on the way in", "clearance": "parts too close to the plastic", "parts_gap": "printed parts touch",
    "retained": "a part is loose", "held": "a board is loose in its holder", "sealed": "a printed part is not a closed solid",
    "wall": "walls too thin to print", "screw_seat": "a screw has nothing to sit on", "screw_grip": "a screw has nothing to bite into",
    "screw_spread": "screws are all on one side", "screw_driver": "a screwdriver cannot reach a screw", "flat_on_bed": "a part has no flat side for the print bed",
    "outer_parts": "an inner part shows on the outside", "access": "something you need to reach is covered", "usb_access": "the USB plug is blocked",
    "plug_room": "a jumper plug has no room", "plug_inside": "a jumper plug sticks out of the case", "plug_clear_parts": "a jumper plug hits another part",
    "shaft_hole": "the knob has no proper hole", "touch_opening": "the touch sensor is covered",
}


def reason_for(outcome, history):
    """A sentence a customer can read, for an attempt that did not pass."""
    if outcome.startswith("stopped: parts do not fit"):
        return "These parts cannot fit this design: " + outcome.split(":", 2)[2].strip() + "."
    if outcome.startswith("stopped: no valid body"):
        return "The outer shape could not be made to fit the parts."
    checked = [h for h in history if h.get("ran")]
    if not checked:
        return "The design code did not run successfully, so no case was checked."
    failed = checked[-1].get("failed", [])
    problems = sorted({CHECK_NAMES.get(f, f.replace("_", " ")) for f in failed})
    return "The last design still failed these checks: " + "; ".join(problems) + "." if problems else "The design did not finish."


def should_retry(outcome):
    """A layout that cannot fit will not fit on a second try either. Everything else may pass on a fresh attempt, with a new outer body."""
    return not outcome.startswith("stopped: parts do not fit")


PICTURE_MAX_BYTES = 10 * 1024 * 1024


def picture_problem(picture):
    """Why a chosen picture cannot be used, or None. Checked before any paid call."""
    path = Path(picture)
    if not path.is_file():
        return "The chosen picture was not found."
    head = path.read_bytes()[:8]
    if not (head.startswith(b"\x89PNG\r\n\x1a\n") or head.startswith(b"\xff\xd8\xff")):
        return "The chosen picture is not a PNG or JPEG image."
    if path.stat().st_size > PICTURE_MAX_BYTES:
        return "The chosen picture is larger than 10 MB."
    return None


def generate(base_path, job, attempts=MAX_ATTEMPTS, design_case=None, picture=None):
    """picture is an optional image the user chose. Without it, nothing changes: the design's own picture is generated."""
    design_case = design_case or agent.design_case
    record = {"job": job, "attempts": []}
    agent.start_job()
    problem = picture and picture_problem(picture)
    if problem:
        record.update(status="FAIL", model=None, message=f"No case was made. {problem}", tokens=0, seconds=0)
        return save(record)
    extra = {"picture": str(picture)} if picture else {}
    for number in range(1, attempts + 1):
        run = job if number == 1 else f"{job}-retry{number - 1}"
        agent.report_progress(stage="starting", attempt=number, attempt_try=0, failed=[])
        before = agent.job_tokens()
        summary = design_case(base_path, None, run, **extra) or {}
        outcome = summary.get("outcome", "stopped: unknown")
        # Every stage counts against the job, so the attempt's tokens come from the job meter, not one stage's summary.
        attempt = {"run": run, "outcome": outcome, "tokens": agent.job_tokens() - before, "seconds": summary.get("seconds", 0)}
        record["attempts"].append(attempt)
        if outcome in PASSING:
            best = summary.get("best_try") or summary.get("tries")
            record.update(status="PASS WITH WARNINGS" if outcome == "pass_with_warnings" else "PASS", model=f"runs/agent/{run}/case/try-{best}",
                          message="Your case is ready." + (" Check the print checklist before printing." if outcome == "pass_with_warnings" else ""))
            break
        attempt["reason"] = reason_for(outcome, summary.get("history", []))
        if not should_retry(outcome) or agent.job_out_of_tokens():
            break
    if "status" not in record:
        last = record["attempts"][-1]
        record.update(status="FAIL", model=None, message=f"No case was made. {last['reason']} Nothing is shown, because it did not pass every must-pass check." + (f" It was tried {len(record['attempts'])} times." if len(record["attempts"]) > 1 else ""))
    record["tokens"] = agent.job_tokens()
    record["seconds"] = round(sum(a["seconds"] for a in record["attempts"]), 1)
    return save(record)


def save(record):
    job = record["job"]
    folder = agent.HERE / "runs" / "jobs"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{job}.json").write_text(json.dumps(record, indent=1), encoding="utf-8")
    agent.report_progress(stage="done", status=record["status"])
    print(json.dumps({k: record[k] for k in ("status", "message", "model", "tokens")}), flush=True)
    return record


if __name__ == "__main__":
    # python generate.py <base design .json> <job> [chosen picture]
    generate(sys.argv[1], sys.argv[2], picture=sys.argv[3] if len(sys.argv) > 3 else None)
