"""The case stage as a step-by-step agent: the AI builds the inside of a frozen body with small tool calls (run the
script, check one group, look at a render, measure the body) instead of writing the whole case in one shot per try.
The AI proposes; the fixed checks still decide. submit() runs every check, and only a passing submit is accepted.

Every step is logged to <folder>/steps.jsonl, and the best passing script is kept, so a bad step never loses one
that worked. Uniform tools: each is execute(name, arguments) -> text (plus a picture for render)."""
import json
import shutil
from pathlib import Path

import checks
import harness
import script_file
from sandbox import run_design

HERE = Path(__file__).resolve().parent
MAX_STEPS = 60          # tool calls in one run
MAX_SUBMITS = 6         # full-check submits
LOOK_TARGET = 8         # a passing case under this look score gets polish submits, while they last
OUTPUT_LIMIT = 2500     # characters of a tool result sent back: every result is resent on each later step

GROUPS = {
    "build": {"design_file", "files", "sealed", "part", "not_rescaled", "one_piece", "case", "holds"},
    "fit": {"clearance", "parts_gap", "insertable", "assembly", "retained", "held", "wall"},
    "openings": {"window_view", "window_fit", "viewing_angle", "screen_share", "screen_faces_viewer", "usb_access",
                 "usb_above_desk", "see_through"},
    "fasteners": {"screw_fit", "screw_spread", "screw_seat", "screw_grip", "screw_gap", "screw_driver", "screw_count",
                  "screw_clear", "snap_strain", "snap_flex", "snap_catch"},
    "outside": {"flat_on_bed", "stands", "outer_parts", "keeps_body"},
}

TOOLS = [
    *script_file.TOOLS,
    {"type": "function", "name": "run", "description": "Run the saved case script. Returns its printed output, or the error. (Passing code saves it first, as write does.)",
     "parameters": {"type": "object", "properties": {"code": {"type": "string", "description": "Optional: a complete script to save first."}}, "additionalProperties": False}},
    {"type": "function", "name": "check", "description": "Run the fixed checks on the last script that ran and return the results for one group: build, fit, openings, fasteners, outside, or all.",
     "parameters": {"type": "object", "properties": {"group": {"type": "string", "enum": [*GROUPS, "all"]}}, "required": ["group"], "additionalProperties": False}},
    {"type": "function", "name": "render", "description": "A picture of the last case that ran (front, straight on, side, back), next to the concept picture.",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"type": "function", "name": "measure", "description": "Run a short read-only snippet with `body` (the frozen body), `data` (the part data) and every case_parts helper already loaded; returns what it prints. For example print(front_surface(body, 30, 25)).",
     "parameters": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"], "additionalProperties": False}},
    {"type": "function", "name": "docs", "description": "The signature and description of case_parts functions and classes whose names contain this text (for example 'Screw', 'pocket'). Use it instead of reading the library's source.",
     "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}},
    {"type": "function", "name": "submit", "description": "Run every check and the look review on the last case that ran. A passing submit is kept; you may submit again to improve the look.",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
]


class Workshop:
    """The sandbox and the tools: one folder holds the frozen body, the library and the latest script."""

    def __init__(self, folder, base, body_stl, picture, part_ids):
        from part_data import write_data
        self.folder, self.base, self.picture, self.body_stl = Path(folder), base, picture, Path(body_stl)
        self.work = self.folder / "work"
        self.work.mkdir(parents=True, exist_ok=True)
        shutil.copy(Path(body_stl).with_suffix(".step"), self.work / "BODY.step")
        shutil.copy(body_stl, self.work / "BODY.stl")
        shutil.copy(HERE / "case_parts.py", self.work / "case_parts.py")
        write_data(part_ids, self.work)
        self.script = script_file.ScriptFile(self.folder / "script.py")
        self.ran, self.report = False, None
        self.best, self.submits, self.look = None, 0, None
        self.tools, self.last_fixes, self.target = TOOLS, [], LOOK_TARGET

    def done(self):
        """The best passing case is good enough to stop: the look target is met, or the look is not reviewed."""
        reviewed = self.picture and self.base.get("style") == "character"
        return self.best is not None and (not reviewed or self.best["score"] >= LOOK_TARGET)

    def state(self):
        """What resume needs beyond the saved script: the counters and the best result."""
        best = dict(self.best, folder=str(self.best["folder"])) if self.best else None
        return {"submits": self.submits, "best": {k: v for k, v in (best or {}).items() if k != "code"} or None,
                "last_fixes": self.last_fixes}

    def restore(self, saved):
        self.submits, self.last_fixes = saved.get("submits", 0), saved.get("last_fixes", [])
        best = saved.get("best")
        self.best = dict(best, folder=Path(best["folder"])) if best else None

    def finish_run(self):
        # Written after the code runs, so the script cannot replace the rules it is checked against.
        (self.work / "base_design.json").write_text(json.dumps(self.base, indent=1), encoding="utf-8")
        shutil.copy(self.body_stl, self.work / "BODY.stl")

    @property
    def code(self):
        return self.script.text

    def run(self, code=None):
        if code:
            self.script.write(code)
        code = self.script.text
        if code is None:
            return "There is no script yet. Write it with write(code)."
        self.ran, message = run_design(code, self.work)
        self.report = None
        if not self.ran:
            return message[-OUTPUT_LIMIT:]
        self.finish_run()
        self.script.snapshot()
        output = (self.work / "output.txt").read_text(encoding="utf-8", errors="replace")
        return ("Ran.\n" + output[-1200:]) if output.strip() else "Ran."

    def checked(self):
        if self.report is None:
            self.report = checks.check_design(self.work, "case")
        return self.report

    def check(self, group):
        if not self.ran:
            return "Nothing has run yet, or the last run failed. Call run() with a script that works."
        report = self.checked()
        names = None if group == "all" else GROUPS[group]
        fields = ("check", "part", "measured", "limit", "where", "fix")
        failed = [{k: r.get(k) for k in fields} for r in report["failed"] if names is None or r["check"] in names]
        warned = [{k: r.get(k) for k in fields} for r in report.get("warnings", []) if names is None or r["check"] in names][:6]
        counted = sum(1 for r in report["results"] if names is None or r["check"] in names)
        if group == "all" and not report["failed"]:
            # Every check passes: submit now, so a passing case is kept before any polishing.
            return "Every check passes, so this case was submitted.\n" + self.submit()
        text = json.dumps({"group": group, "checks_run": counted, "failed": failed, "warnings": warned}, default=str)
        if not report.get("complete", True):
            text += "\nSome checks did not run because the build itself failed; fix the build group first."
        return text[-OUTPUT_LIMIT:]

    def render(self):
        if not self.ran:
            return "Nothing has run yet.", None
        from preview import render
        out = render(self.work)
        return "The picture is attached: first the concept, then your case.", out

    def measure(self, code):
        probe = self.folder / "probe"
        if probe.exists():
            shutil.rmtree(probe)
        probe.mkdir()
        for name in ("BODY.step", "case_parts.py", "parts_data.json"):
            if (self.work / name).exists():
                shutil.copy(self.work / name, probe / name)
        head = ("from build123d import import_step\nfrom case_parts import *\n"
                "body = one_solid(import_step('BODY.step'), 'body')\ndata = load_data()\n")
        ok, message = run_design(head + code, probe)
        output = (probe / "output.txt").read_text(encoding="utf-8", errors="replace") if (probe / "output.txt").exists() else ""
        return (output if ok else message)[-OUTPUT_LIMIT:] or "(printed nothing)"

    def docs(self, name):
        import inspect
        import case_parts
        found = []
        for key, value in inspect.getmembers(case_parts):
            if name.lower() in key.lower() and (inspect.isfunction(value) or inspect.isclass(value)) and value.__module__ == "case_parts":
                try:
                    signature = str(inspect.signature(value))
                except (TypeError, ValueError):
                    signature = "(...)"
                found.append(f"{key}{signature}: {inspect.getdoc(value) or ''}")
        return ("\n\n".join(found) or f"Nothing in case_parts is named like {name!r}.")[:OUTPUT_LIMIT]

    def submit(self):
        if not self.ran:
            return "Nothing has run yet."
        self.submits += 1
        report = self.checked()
        look = None
        if self.picture and self.base.get("style") == "character":
            import case_look
            from preview import render
            render(self.work)
            try:
                look = case_look.review(self.work, self.picture, self.base, self.base.get("body_score"))
            except Exception as error:
                print(f"no look review: {error}", flush=True)
        problems = [{k: r.get(k) for k in ("check", "part", "measured", "limit", "where", "fix")} for r in report["failed"]]
        if look and look["problems"]:
            problems.append({"check": "look_review", "fix": " ".join(look["problems"])})
        passed = report["passed"] and not (look and look["problems"])
        score = (look or {}).get("score") or 0
        self.last_fixes = (look or {}).get("fix", []) or [p.get("fix") for p in problems if p.get("fix")]
        # The report (and look.json, written by the review) travel with the snapshot, so its viewer shows the real checks.
        (self.work / "report.json").write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
        snapshot = self.folder / f"submit-{self.submits}"
        if snapshot.exists():
            shutil.rmtree(snapshot)
        shutil.copytree(self.work, snapshot)
        try:
            from viewer import build
            build(snapshot)
        except Exception as error:
            print(f"no viewer: {error}", flush=True)
        if passed and (self.best is None or score > self.best["score"]):
            self.best = {"score": score, "code": self.code, "folder": snapshot, "status": report.get("status")}
        result = {"passed": passed, "failed": problems[:12], "look_score": score if look else None,
                  "look_fixes": (look or {}).get("fix", []), "submits_left": MAX_SUBMITS - self.submits}
        if passed:
            result["note"] = ("Accepted and kept. " + (f"The look is {score}/10, under the target {LOOK_TARGET}: polish it "
                              "and submit again if you can; a worse submit never replaces this one." if score < LOOK_TARGET and look else "Done."))
        return json.dumps(result, default=str)[-OUTPUT_LIMIT:]

    def execute(self, name, arguments):
        """Every tool is one call: name + arguments -> (text, picture or None)."""
        if name == "write":
            return self.script.write(arguments.get("code", "")), None
        if name == "edit":
            return self.script.edit(arguments.get("old", ""), arguments.get("new", ""))[1], None
        if name == "show":
            return self.script.show(arguments.get("start"), arguments.get("end"), arguments.get("find")), None
        if name == "run":
            return self.run(arguments.get("code")), None
        if name == "check":
            return self.check(arguments.get("group", "all")), None
        if name == "render":
            return self.render()
        if name == "measure":
            return self.measure(arguments.get("code", "")), None
        if name == "docs":
            return self.docs(arguments.get("name", "")), None
        if name == "submit":
            return self.submit(), None
        return f"Unknown tool {name}.", None


def design_case(brief, folder, base, body_stl, picture, part_ids, system, resume=False):
    """Runs the agent. Returns a summary, with the best passing case copied to <folder>/best."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    shop = Workshop(folder, base, body_stl, picture, part_ids)
    # The one-shot system prompt asks for a single script reply; here the script goes through run() instead.
    system = system.replace("Reply with only the script, in one ```python block. ", "Pass the complete script to the run tool each time. ")
    instructions = system + "\n\n" + harness.guide("case")
    outcome, steps, tokens, seconds = harness.run(shop, instructions, brief, folder, picture, MAX_STEPS, MAX_SUBMITS, "case", resume)
    if shop.best:
        target = folder / "best"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(shop.best["folder"], target)
    summary = {"outcome": outcome, "steps": steps, "submits": shop.submits, "look_score": shop.best["score"] if shop.best else None,
               "best": str(folder / "best") if shop.best else None, "tokens": tokens, "seconds": seconds}
    (folder / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    return summary
