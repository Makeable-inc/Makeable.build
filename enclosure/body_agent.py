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
import review_facts
import script_file
from case_look import ask, sheet
from checks import load_stl
from sandbox import run_design

HERE = Path(__file__).resolve().parent
MAX_STEPS = 60
MAX_SUBMITS = 6
LOOK_TARGET = 8
CHARACTER_TARGET = 7   # the character review, once the key features are on, must reach this before submit
GATE_TRIES = 2         # character reviews under the target before the gate is skipped (and the skip recorded)
SIDE_WORDS = {"left", "right", "top", "bottom", "front", "back", "upper", "lower", "middle", "side"}
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

PROPORTION = RUBRIC + """
Image 1 is the concept, image 2 is the main form only: the features (ears, spikes, tail, eyes...) are not on yet, so
do not judge whether it reads as the character. Judge only the proportions and silhouette against the concept:
length, height, how soft or boxy it is, where it is fuller or slimmer. Reply with only JSON:
{"proportions": "<at most 2 sentences>", "fix": ["<up to 2 concrete changes in mm or proportions>"]}"""

CHARACTER = RUBRIC + """
Image 1 is the concept, image 2 is the body with its key features on (no screen or knob yet). Ignore colours.
Does it read as the concept? Reply with only JSON: {"score": <0-10>, "fix": ["<up to 3 concrete changes, most
important first>"]}"""

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
        self.built = None            # the script text of the last build that worked: only that can be submitted
        self.proportion_done = False
        self.character = {"score": None, "tries": 0, "done": False}
        self.skipped_gates = []
        self.features_built = set()  # features already on an accepted build, so the next may add one new kind

    def done(self):
        return self.best is not None and self.best["score"] >= LOOK_TARGET

    @property
    def code(self):
        return self.script.text

    def state(self):
        """What resume needs beyond the saved script: the counters and the best result."""
        best = dict(self.best, folder=str(self.best["folder"])) if self.best else None
        return {"submits": self.submits, "best": {k: v for k, v in (best or {}).items() if k != "code"} or None,
                "last_fixes": self.last_fixes, "proportion_done": self.proportion_done, "character": self.character,
                "skipped_gates": self.skipped_gates, "features_built": sorted(self.features_built)}

    def restore(self, saved):
        self.submits, self.last_fixes = saved.get("submits", 0), saved.get("last_fixes", [])
        self.proportion_done = saved.get("proportion_done", False)
        self.character = saved.get("character", self.character)
        self.skipped_gates = saved.get("skipped_gates", [])
        self.features_built = set(saved.get("features_built", []))
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
        output = (self.work / "output.txt").read_text(encoding="utf-8", errors="replace")
        refused = self.out_of_order(output)
        if refused:
            # Not accepted: the body that ran skipped a step, so it cannot be checked, reviewed or submitted.
            return refused
        self.ran, self.mesh, self.output = True, load_stl(self.work / "BODY.stl"), output
        self.built = code
        self.features_built |= set(body_rules.printed(output, "added") or [])
        self.script.snapshot()
        return ("Ran.\n" + self.output[-1500:]).strip() + self.staged_review()

    def out_of_order(self, output):
        """The build order is enforced, not only advised: the main form alone first, so its proportions are reviewed
        before any feature; then one kind of feature per build, so each can be checked and seen on its own."""
        if not (self.picture and self.features):
            return None
        added = set(body_rules.printed(output, "added") or [])
        if not self.proportion_done and added:
            return ("Not accepted: this build adds features (" + ", ".join(sorted(added)) + ") before the main form's "
                    "proportions were reviewed. Build the main form alone first (no try_join), with room and size "
                    "passing, so it can be reviewed; then add the features.")
        def kind_of(feature):
            # "left ear" and "right ear" are one kind, as are "spike 1" and "spike 2"
            words = [w for w in feature["name"].lower().split() if w not in SIDE_WORDS and not w.isdigit()]
            return feature.get("kind") or " ".join(words) or feature["name"]
        kind = {f["name"]: kind_of(f) for f in self.features}
        new = added - self.features_built
        kinds = sorted({kind.get(name, name) for name in new})
        if len(kinds) > 1:
            return ("Not accepted: this build adds more than one kind of feature at once (" + ", ".join(kinds) + "). "
                    "Add one kind per build (all the spikes together is fine), so each is checked and seen on its own.")
        return None

    def facts(self):
        try:
            return review_facts.facts(self.base, review_facts.body_size(self.mesh))
        except Exception:
            return review_facts.facts(self.base)

    def fixes_that_fit(self, fixes):
        try:
            size = review_facts.body_size(self.mesh)
        except Exception:
            size = None
        kept, _ = review_facts.filter_fixes([str(f) for f in fixes if f], self.base, size)
        return kept

    def staged_review(self):
        """The two look checks that come before submit: proportions once the main form fits (advice), and the character
        once every key feature is on (a gate: under CHARACTER_TARGET, fix before submit, at most GATE_TRIES times)."""
        if not self.picture:
            return ""
        notes = []
        added = set(body_rules.printed(self.output, "added") or [])
        features_on = bool(self.features) and all(f["name"] in added for f in self.features)
        if not self.proportion_done and not features_on and not [r for r in self.rules(("room", "size")) if not r["ok"]]:
            self.proportion_done = True
            board = sheet(self.picture, self.view(), self.view(), self.work / "look_sheet.png")
            found, _ = ask(PROPORTION + "\n\n" + self.facts(), board)
            fixes = self.fixes_that_fit(found.get("fix", []) if isinstance(found.get("fix"), list) else [])
            notes.append(f"Proportion review (advice; features not judged yet): {found.get('proportions', '')} "
                         + (f"Fixes: {'; '.join(fixes)}" if fixes else ""))
        if features_on and not self.character["done"]:
            board = sheet(self.picture, self.view(), self.view(), self.work / "look_sheet.png")
            found, _ = ask(CHARACTER + "\n\n" + self.facts(), board)
            score = found.get("score") if isinstance(found.get("score"), (int, float)) else 0
            fixes = self.fixes_that_fit(found.get("fix", []) if isinstance(found.get("fix"), list) else [])
            self.character["score"], self.character["tries"] = score, self.character["tries"] + 1
            self.last_fixes = fixes or self.last_fixes
            if score >= CHARACTER_TARGET:
                self.character["done"] = True
                notes.append(f"Character review: {score}/10, it reads. Finish the back and sole, then submit.")
            elif self.character["tries"] >= GATE_TRIES:
                self.character["done"] = True
                self.skipped_gates.append(f"character review under {CHARACTER_TARGET} after {GATE_TRIES} tries (last {score}/10)")
                notes.append(f"Character review: {score}/10 after {GATE_TRIES} tries; moving on (recorded). You may submit.")
            else:
                notes.append(f"Character review: {score}/10, under {CHARACTER_TARGET}. Fix this before submitting "
                             f"(try {self.character['tries']} of {GATE_TRIES}): {'; '.join(fixes) or 'make it read as the concept'}")
        return ("\n\n" + "\n".join(notes)) if notes else ""

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
        found, _ = ask(QUESTION + question + "\n\n" + self.facts() + '\nReply with only JSON: {"answer": "<your answer>"}', board)
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
        if self.script.text != self.built:
            return "The saved script changed since the last build, so this body has not been checked. build() it first."
        if self.picture and self.features and not self.character["done"]:
            added = set(body_rules.printed(self.output, "added") or [])
            if all(f["name"] in added for f in self.features):
                return (f"The character review is {self.character['score']}/10, under {CHARACTER_TARGET}. Make its fixes and build() "
                        f"again first (try {self.character['tries']} of {GATE_TRIES}).")
        self.submits += 1
        found = self.rules()
        failed = [{k: r[k] for k in ("rule", "measured", "fix")} for r in found if not r["ok"]]
        names = "\n".join(f"- {f['name']} ({f.get('where', '')})" for f in self.features) or "- (none listed)"
        review, score, fixes = {}, 0, []
        if self.picture:
            board = sheet(self.picture, self.view(), self.view(), self.work / "look_sheet.png")
            review, _ = ask(REVIEW + names + "\n\n" + self.facts(), board)
            score = review.get("score") if isinstance(review.get("score"), (int, float)) else 0
            fixes = self.fixes_that_fit(review.get("fix", []) if isinstance(review.get("fix"), list) else [])
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
    example = (HERE / "body_examples" / "neutral.py").read_text(encoding="utf-8")
    return "\n\n".join(["\n".join(lines), "Features the body must have, each one clearly there:\n" + features,
                        "A worked example of the method (not a character: copy the order and the way sizes come from the room, not its shapes or sizes):\n```python\n" + example + "\n```"])


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
