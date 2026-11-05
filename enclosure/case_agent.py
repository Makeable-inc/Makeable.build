"""The case stage as a step-by-step agent: the AI builds the inside of a frozen body with small tool calls (run the
script, check one group, look at a render, measure the body) instead of writing the whole case in one shot per try.
The AI proposes; the fixed checks still decide. submit() runs every check, and only a passing submit is accepted.

Every step is logged to <folder>/steps.jsonl, and the best passing script is kept, so a bad step never loses one
that worked. Uniform tools: each is execute(name, arguments) -> text (plus a picture for render)."""
import base64
import json
import shutil
import time
from pathlib import Path

import agent
import checks
from sandbox import run_design

HERE = Path(__file__).resolve().parent
MAX_STEPS = 40          # tool calls in one run
MAX_SUBMITS = 4         # full-check submits
LOOK_TARGET = 8         # a passing case under this look score gets polish submits, while they last
OUTPUT_LIMIT = 6000     # characters of a tool result sent back

GROUPS = {
    "build": {"design_file", "files", "sealed", "part", "not_rescaled", "one_piece", "case", "holds"},
    "fit": {"clearance", "parts_gap", "insertable", "assembly", "retained", "held", "wall"},
    "openings": {"window_view", "window_fit", "viewing_angle", "screen_share", "screen_faces_viewer", "usb_access",
                 "usb_above_desk", "see_through"},
    "fasteners": {"screw_fit", "screw_spread", "screw_seat", "screw_grip", "screw_gap", "screw_driver", "screw_count",
                  "screw_clear", "snap_strain", "snap_flex", "snap_catch"},
    "outside": {"flat_on_bed", "stands", "outer_parts", "keeps_body"},
}

STEPS = """Work in small steps, checking each before the next. A good order:
1. Load the body, place the parts (screen, inputs, controller) and split at the seam; run, then check("fit").
2. Cut the pockets and fitted openings; run, then check("openings").
3. Add screws or snaps, stops and the holder; run, then check("fasteners") and check("outside").
4. render() and compare with the concept: the case must keep every feature of the body and look like the concept.
5. submit(). If it fails, fix what it names and submit again. If it passes but the look is under target, polish the
   look (bezel, knob cap, openings that suit the character) and submit again; the best passing case is kept.
Change one thing at a time. Use measure() instead of guessing a position. Never cut through a feature of the body
(an arm, ear, foot or antenna): move the opening or the part instead."""

TOOLS = [
    {"type": "function", "name": "run", "description": "Save this as the complete case script (design.py) and run it. Returns its printed output, or the error.",
     "parameters": {"type": "object", "properties": {"code": {"type": "string", "description": "The complete Python script."}}, "required": ["code"], "additionalProperties": False}},
    {"type": "function", "name": "check", "description": "Run the fixed checks on the last script that ran and return the results for one group: build, fit, openings, fasteners, outside, or all.",
     "parameters": {"type": "object", "properties": {"group": {"type": "string", "enum": [*GROUPS, "all"]}}, "required": ["group"], "additionalProperties": False}},
    {"type": "function", "name": "render", "description": "A picture of the last case that ran (front, straight on, side, back), next to the concept picture.",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"type": "function", "name": "measure", "description": "Run a short read-only snippet with `body` (the frozen body), `data` (the part data) and every case_parts helper already loaded; returns what it prints. For example print(front_surface(body, 30, 25)).",
     "parameters": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"], "additionalProperties": False}},
    {"type": "function", "name": "submit", "description": "Run every check and the look review on the last case that ran. A passing submit is kept; you may submit again to improve the look.",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
]


def call(body, previous=None):
    request = {"model": agent.MODEL, "tools": TOOLS, "reasoning": {"effort": "medium"}, **body}
    if previous:
        request["previous_response_id"] = previous
    import urllib.request
    data = agent.send_with_retries(urllib.request.Request(
        "https://api.openai.com/v1/responses", data=json.dumps(request).encode(),
        headers={"Authorization": f"Bearer {agent.api_key()}", "Content-Type": "application/json"}))
    agent.spend(data.get("usage", {}))
    return data


def image_part(path):
    return {"type": "input_image", "image_url": "data:image/png;base64," + base64.b64encode(Path(path).read_bytes()).decode()}


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
        self.code, self.ran, self.report = None, False, None
        self.best, self.submits, self.look = None, 0, None

    def finish_run(self):
        # Written after the code runs, so the script cannot replace the rules it is checked against.
        (self.work / "base_design.json").write_text(json.dumps(self.base, indent=1), encoding="utf-8")
        shutil.copy(self.body_stl, self.work / "BODY.stl")

    def run(self, code):
        self.code = code
        self.ran, message = run_design(code, self.work)
        self.report = None
        if not self.ran:
            return message[-OUTPUT_LIMIT:]
        self.finish_run()
        output = (self.work / "output.txt").read_text(encoding="utf-8", errors="replace")
        return ("Ran.\n" + output)[-OUTPUT_LIMIT:]

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
        snapshot = self.folder / f"submit-{self.submits}"
        if snapshot.exists():
            shutil.rmtree(snapshot)
        shutil.copytree(self.work, snapshot)
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
        if name == "run":
            return self.run(arguments.get("code", "")), None
        if name == "check":
            return self.check(arguments.get("group", "all")), None
        if name == "render":
            return self.render()
        if name == "measure":
            return self.measure(arguments.get("code", "")), None
        if name == "submit":
            return self.submit(), None
        return f"Unknown tool {name}.", None


def log(folder, **entry):
    with open(Path(folder) / "steps.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"time": round(time.time(), 1), **entry}, default=str)[:20000] + "\n")


def design_case(brief, folder, base, body_stl, picture, part_ids, system):
    """Runs the agent. Returns a summary like agent.design_part, with the best passing case copied to <folder>/best."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    shop = Workshop(folder, base, body_stl, picture, part_ids)
    started, steps, tokens = time.time(), 0, 0
    # The one-shot system prompt asks for a single script reply; here the script goes through run() instead.
    system = system.replace("Reply with only the script, in one ```python block. ", "Pass the complete script to the run tool each time. ")
    instructions = system + "\n\nYou work through tools, not one reply.\n" + STEPS
    content = [{"type": "input_text", "text": brief}]
    if picture:
        content.append(image_part(picture))
    data = call({"instructions": instructions, "input": [{"role": "user", "content": content}]})
    outcome = None
    while True:
        tokens += data.get("usage", {}).get("total_tokens", 0)
        calls = [item for item in data["output"] if item["type"] == "function_call"]
        said = "".join(c.get("text", "") for item in data["output"] if item["type"] == "message" for c in item["content"])
        if said:
            log(folder, step=steps, said=said[:2000])
        if not calls:
            outcome = "stopped: the agent stopped calling tools"
            break
        results, pictures = [], []
        for item in calls:
            steps += 1
            arguments = json.loads(item.get("arguments") or "{}")
            began = time.time()
            text, picture_out = shop.execute(item["name"], arguments)
            log(folder, step=steps, tool=item["name"], arguments=arguments, result=text[:3000], seconds=round(time.time() - began, 1))
            print(f"step {steps}: {item['name']} {text[:160]!r}", flush=True)
            results.append({"type": "function_call_output", "call_id": item["call_id"], "output": text})
            if picture_out:
                pictures.append(picture_out)
        follow = list(results)
        if pictures:
            parts = [{"type": "input_text", "text": "Concept, then your case:"}]
            if picture:
                parts.append(image_part(picture))
            parts += [image_part(p) for p in pictures]
            follow.append({"role": "user", "content": parts})
        best = shop.best
        if best and (best["score"] >= LOOK_TARGET or not (picture and base.get("style") == "character")):
            outcome = best["status"] or "passed"
            break
        if shop.submits >= MAX_SUBMITS:
            outcome = best["status"] if best else "stopped: used all submits"
            break
        if steps >= MAX_STEPS:
            outcome = best["status"] if best else f"stopped: used all {MAX_STEPS} steps"
            break
        if agent.job_out_of_tokens():
            outcome = best["status"] if best else agent.token_limit_reason()
            break
        if steps >= MAX_STEPS - 3:
            follow.append({"role": "user", "content": [{"type": "input_text", "text": "Only a few steps are left: submit your best case now."}]})
        data = call({"input": follow}, previous=data["id"])
    if shop.best:
        target = folder / "best"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(shop.best["folder"], target)
    summary = {"outcome": outcome, "steps": steps, "submits": shop.submits, "look_score": shop.best["score"] if shop.best else None,
               "best": str(folder / "best") if shop.best else None, "tokens": tokens, "seconds": round(time.time() - started, 1)}
    (folder / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    return summary
