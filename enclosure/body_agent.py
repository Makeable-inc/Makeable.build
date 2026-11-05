"""The body stage as a step-by-step agent: the AI builds the outer body with small tool calls (build the script,
check one group of rules, look at a render, ask one look question) instead of writing the whole body in one shot.
The AI proposes; body_rules decide. submit() runs every rule and the look review; the best passing body is kept."""
import inspect
import json
import shutil
from pathlib import Path

import body_parts
import body_rules
import harness
import script_file
from case_look import ask, sheet
from checks import load_stl
from sandbox import run_design

HERE = Path(__file__).resolve().parent
MAX_STEPS = 60
MAX_SUBMITS = 6
LOOK_TARGET = 8
OUTPUT_LIMIT = 2500

SYSTEM = """You are a product designer who models characterful desk gadgets in code with build123d and the tested
body_parts building blocks. Millimetres, world +z up, the front facing -y, standing on z = 0. Allowed imports:
build123d, math, json, pathlib, body_parts. The script builds the solid OUTER BODY only (no cavity, window or holes)
and ends with:
    export_stl(body, "BODY.stl", tolerance=0.01)
    export_step(body, "BODY.step")
and prints, as the worked example does, the added and skipped features and feature_report()."""

RUBRIC = """Design principles a good body follows:
- The silhouette and proportions match the concept; the front is the screen's face.
- One consistent softness: every outer edge rounded alike.
- Features (ears, arms, feet, antennas) are in proportion and grow out of the body, not stuck on.
- Simple, bold shapes that read from a metre away.
Score anchors: 2 = a plain box; 3 = a box with stickers on; 5 = recognisable as the concept but crude;
7 = a good toy a shop would sell; 9 = a polished product with every principle met."""

REVIEW = RUBRIC + """
Image 1 is the concept, image 2 is the body so far from four angles (no screen or knob yet). Ignore colours.
Reply with only JSON: {"features": {"<feature name>": "present" | "weak" | "missing"}, "score": <0-10>,
"fix": ["<up to 4 concrete changes in mm or proportions, most important first>"]}
Required features:
"""

QUESTION = RUBRIC + """
Image 1 is the concept, image 2 is the body so far. Answer this one question in at most 3 sentences, ending with
the single most useful change in mm or proportions: """

TOOLS = [
    *script_file.TOOLS,
    {"type": "function", "name": "build", "description": "Run the saved body script. Returns what it printed, or the error. (Passing code saves it first, as write does.)",
     "parameters": {"type": "object", "properties": {"code": {"type": "string", "description": "Optional: a complete script to save first."}}, "additionalProperties": False}},
    {"type": "function", "name": "check", "description": "Run the body rules on the last body built, for one group: build, size, room, back, features, or all.",
     "parameters": {"type": "object", "properties": {"group": {"type": "string", "enum": [*body_rules.GROUPS, "all"]}}, "required": ["group"], "additionalProperties": False}},
    {"type": "function", "name": "measure", "description": "Run a short read-only snippet with `body` (the last body built, from BODY.step) and every body_parts helper loaded; returns what it prints. For example print(surface_z(body, 30, 0)).",
     "parameters": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"], "additionalProperties": False}},
    {"type": "function", "name": "render", "description": "A picture of the last body built (front, straight on, side, back), next to the concept.",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"type": "function", "name": "look", "description": "Ask the look reviewer one question about the last body built, for example 'do the ears read as cat ears?'.",
     "parameters": {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"], "additionalProperties": False}},
    {"type": "function", "name": "docs", "description": "The signature and description of body_parts building blocks whose names contain this text.",
     "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"], "additionalProperties": False}},
    {"type": "function", "name": "submit", "description": "Run every body rule and the full look review on the last body built. A passing submit is kept.",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
]


class BodyShop:
    def __init__(self, folder, base, picture):
        self.folder, self.base, self.picture = Path(folder), base, picture
        self.features = base.get("features") or []
        self.work = self.folder / "work"
        self.work.mkdir(parents=True, exist_ok=True)
        self.script = script_file.ScriptFile(self.folder / "script.py")
        self.ran, self.mesh, self.output = False, None, ""
        self.best, self.submits, self.tools, self.last_fixes, self.target = None, 0, TOOLS, [], LOOK_TARGET

    def done(self):
        return self.best is not None and self.best["score"] >= LOOK_TARGET

    @property
    def code(self):
        return self.script.text

    def state(self):
        """What resume needs beyond the saved script: the counters and the best result."""
        best = dict(self.best, folder=str(self.best["folder"])) if self.best else None
        return {"submits": self.submits, "best": {k: v for k, v in (best or {}).items() if k != "code"} or None,
                "last_fixes": self.last_fixes}

    def restore(self, saved):
        self.submits, self.last_fixes = saved.get("submits", 0), saved.get("last_fixes", [])
        best = saved.get("best")
        self.best = dict(best, folder=Path(best["folder"])) if best else None

    def build(self, code=None):
        if code:
            self.script.write(code)
        code = self.script.text
        if code is None:
            return "There is no script yet. Write it with write(code)."
        shutil.copy(HERE / "body_parts.py", self.work / "body_parts.py")
        for name in ("BODY.stl", "BODY.step", "preview.png"):
            (self.work / name).unlink(missing_ok=True)
        ok, message = run_design(code, self.work)
        self.ran, self.mesh = False, None
        if not ok:
            return message[-OUTPUT_LIMIT:]
        if not (self.work / "BODY.stl").exists() or not (self.work / "BODY.step").exists():
            return "It ran but did not export BODY.stl and BODY.step. End with export_stl and export_step as the instructions say."
        self.ran, self.mesh = True, load_stl(self.work / "BODY.stl")
        self.script.snapshot()
        self.output = (self.work / "output.txt").read_text(encoding="utf-8", errors="replace")
        return ("Ran.\n" + self.output[-1500:]).strip()

    def rules(self, groups=body_rules.GROUPS):
        return body_rules.check(self.mesh, self.base, self.features, self.output, self.work / "BODY.step", groups)

    def check(self, group):
        if not self.ran:
            return "Nothing has been built yet, or the last build failed."
        found = self.rules(body_rules.GROUPS if group == "all" else (group,))
        failed = [{k: r[k] for k in ("rule", "measured", "fix")} for r in found if not r["ok"]]
        return json.dumps({"group": group, "rules_run": len(found), "failed": failed}, default=str)[-OUTPUT_LIMIT:]

    def view(self):
        from body_stage import render
        out = self.work / "preview.png"
        if not out.exists():
            render(self.mesh, out)
        return out

    def render(self):
        if not self.ran:
            return "Nothing has been built yet.", None
        return "The picture is attached: first the concept, then your body.", self.view()

    def measure(self, code):
        if not self.ran:
            return "Nothing has been built yet."
        probe = self.folder / "probe"
        shutil.rmtree(probe, ignore_errors=True)
        probe.mkdir()
        shutil.copy(self.work / "BODY.step", probe / "BODY.step")
        shutil.copy(HERE / "body_parts.py", probe / "body_parts.py")
        head = "from build123d import import_step\nfrom body_parts import *\nbody = one_solid(import_step('BODY.step'), 'body')\n"
        ok, message = run_design(head + code, probe)
        output = (probe / "output.txt").read_text(encoding="utf-8", errors="replace") if (probe / "output.txt").exists() else ""
        return (output if ok else message)[-OUTPUT_LIMIT:] or "(printed nothing)"

    def look(self, question):
        if not self.ran or not self.picture:
            return "Nothing to look at yet."
        board = sheet(self.picture, self.view(), self.view(), self.work / "look_sheet.png")
        found, _ = ask(QUESTION + question + '\nReply with only JSON: {"answer": "<your answer>"}', board)
        return str(found.get("answer") or found)[:1200]

    def docs(self, name):
        found = []
        for key, value in inspect.getmembers(body_parts, inspect.isfunction):
            if name.lower() in key.lower() and value.__module__ == "body_parts" and not key.startswith("_"):
                found.append(f"{key}{inspect.signature(value)}: {inspect.getdoc(value) or ''}")
        return ("\n\n".join(found) or f"Nothing in body_parts is named like {name!r}.")[:OUTPUT_LIMIT]

    def submit(self):
        if not self.ran:
            return "Nothing has been built yet."
        self.submits += 1
        found = self.rules()
        failed = [{k: r[k] for k in ("rule", "measured", "fix")} for r in found if not r["ok"]]
        names = "\n".join(f"- {f['name']} ({f.get('where', '')})" for f in self.features) or "- (none listed)"
        review, score, fixes = {}, 0, []
        if self.picture:
            board = sheet(self.picture, self.view(), self.view(), self.work / "look_sheet.png")
            review, _ = ask(REVIEW + names, board)
            score = review.get("score") if isinstance(review.get("score"), (int, float)) else 0
            fixes = review.get("fix", []) if isinstance(review.get("fix"), list) else []
        passed = not failed
        self.last_fixes = fixes or [f["fix"] for f in failed if f.get("fix")]
        snapshot = self.folder / f"submit-{self.submits}"
        shutil.rmtree(snapshot, ignore_errors=True)
        shutil.copytree(self.work, snapshot)
        (snapshot / "body.py").write_text(self.code, encoding="utf-8")
        (snapshot / "review.json").write_text(json.dumps(review, indent=1), encoding="utf-8")
        if passed and (self.best is None or score > self.best["score"]):
            self.best = {"score": score, "folder": snapshot, "status": "passed"}
        result = {"passed": passed, "failed": failed[:10], "look_score": score, "look_fixes": fixes[:4],
                  "submits_left": MAX_SUBMITS - self.submits}
        if passed:
            result["note"] = "Accepted and kept." + (f" The look is {score}/10, under the target {LOOK_TARGET}: improve the weakest "
                                                     "feature or the silhouette and submit again." if score < LOOK_TARGET else " Done.")
        return json.dumps(result, default=str)[-OUTPUT_LIMIT:]

    def execute(self, name, arguments):
        if name == "write":
            return self.script.write(arguments.get("code", "")), None
        if name == "edit":
            return self.script.edit(arguments.get("old", ""), arguments.get("new", ""))[1], None
        if name == "show":
            return self.script.show(arguments.get("start"), arguments.get("end"), arguments.get("find")), None
        if name == "build":
            return self.build(arguments.get("code")), None
        if name == "check":
            return self.check(arguments.get("group", "all")), None
        if name == "render":
            return self.render()
        if name == "measure":
            return self.measure(arguments.get("code", "")), None
        if name == "look":
            return self.look(arguments.get("question", "")), None
        if name == "docs":
            return self.docs(arguments.get("name", "")), None
        if name == "submit":
            return self.submit(), None
        return f"Unknown tool {name}.", None


def brief(base):
    """The body brief, with the flat back plate in place of a fully flat back, and the features to show."""
    from body_stage import body_brief
    lines = [line for line in body_brief(base).split("\n") if not line.startswith("The back, opposite the front")]
    lines.append("The back, opposite the front, becomes a printed cover that must lie flat on a print bed: cut it with "
                 "broad_flat_back(body, share=0.65); the cover is that plate and stays completely flat.")
    features = "\n".join(f"- {f['name']}: {f.get('kind', '')}, {f['where']}" for f in base.get("features") or []) or "- (none listed)"
    example = (HERE / "body_examples" / "kitten.py").read_text(encoding="utf-8")
    return "\n\n".join(["\n".join(lines), "Features the body must have, each one clearly there:\n" + features,
                        "A worked example of the building blocks in use (a different product; copy the method, not its sizes):\n```python\n" + example + "\n```"])


def design_body(base, picture, folder, resume=False):
    """Runs the body agent. Returns (code, stl path, summary) like body_stage.design_body; the best passing body
    is copied to <folder> (BODY.stl, BODY.step, body.py, summary.json)."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    shop = BodyShop(folder, base, picture)
    instructions = SYSTEM + "\n\n" + harness.guide("body")
    outcome, steps, tokens, seconds = harness.run(shop, instructions, brief(base), folder, picture, MAX_STEPS, MAX_SUBMITS, "body", resume)
    summary = {"result": harness.result_label(shop.best, LOOK_TARGET, bool(picture)), "outcome": outcome, "steps": steps,
               "submits": shop.submits, "best_score": shop.best["score"] if shop.best else None, "features": shop.features,
               "style": "character", "skipped_gates": getattr(shop, "skipped_gates", []), "tokens": tokens, "seconds": seconds}
    (folder / "summary.json").write_text(json.dumps(summary, indent=1, default=str), encoding="utf-8")
    if not shop.best:
        return None, None, summary
    for name in ("BODY.stl", "BODY.step", "body.py", "preview.png"):
        if (shop.best["folder"] / name).exists():
            shutil.copy(shop.best["folder"] / name, folder / name)
    return (folder / "body.py").read_text(encoding="utf-8"), folder / "BODY.stl", summary
