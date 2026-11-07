"""The shared agent loop for the body and case stages: the model calls tools, the tools act on a sandbox folder, and
every step goes to <folder>/steps.jsonl. A shop (the stage's tools) holds the state and the best accepted result.

A shop provides: tools (OpenAI function tool list), execute(name, arguments) -> (text, picture or None),
submits (int), best (dict with "score", "folder", "status") or None, done() -> bool (the best is good enough),
and code (the current script text, or None). Uniform tools: name + arguments in, text (and maybe a picture) out.

Keeping the context in check:
- every model call logs its input, cached and output tokens (steps.jsonl, "model" lines);
- a long tool result is stored whole in <folder>/results/rN.txt and the agent gets a short version with a
  reference it can fetch with recall("rN");
- past COMPACT_AT input tokens on one call, the agent writes a handoff summary and the loop starts a fresh response
  chain from the summary, the current file, the latest results and the concept picture.

Resuming: after every step <folder>/state.json holds the counters, the best result, the latest results and the
last handoff summary (the script itself is already saved). run(..., resume=True) continues from it on a fresh chain.
A shop that keeps state provides state() -> dict and restore(dict)."""
import base64
import json
import re
import os
import time
import urllib.request
from pathlib import Path

import agent

GUIDES = Path(__file__).resolve().parent / "guides"
MAX_NUDGES = 2          # times the agent is sent back when it stops short of the goal with budget left
SHORT_LIMIT = 1500      # characters: a longer tool result is stored and shortened
HEAD, TAIL = 900, 300   # characters of a shortened result kept from its start and its end
COMPACT_AT = int(os.environ.get("ENCLOSURE_COMPACT_AT", 30_000))  # input tokens on one call (0 = never); set from the dino log: calls grow ~700 tokens each, so this compacts about once per stage
SUMMARY_LIMIT = 1500    # characters in a handoff summary

RECALL = {"type": "function", "name": "recall", "description": "The full text of an earlier tool result that was shortened, by its reference, for example recall('r12').",
          "parameters": {"type": "object", "properties": {"ref": {"type": "string"}}, "required": ["ref"], "additionalProperties": False}}

HANDOFF = f"""Write a handoff summary for yourself, at most {SUMMARY_LIMIT} characters, no tool calls. A fresh session continues
from it with the current file, so keep only what it needs: the facts that still hold (what passes), the open
problems (what fails or looks wrong, with numbers), the decisions taken and why, and the next step."""


def guide(name):
    """The stage's guide: which tool to call when, what good looks like, what not to do."""
    return (GUIDES / f"{name}.md").read_text(encoding="utf-8")


def call(tools, body, previous=None):
    request = {"model": agent.MODEL, "tools": tools, "reasoning": {"effort": "medium"}, **body}
    if previous:
        request["previous_response_id"] = previous
    data = agent.send_with_retries(urllib.request.Request(
        "https://api.openai.com/v1/responses", data=json.dumps(request).encode(),
        headers={"Authorization": f"Bearer {agent.api_key()}", "Content-Type": "application/json"}))
    agent.spend(data.get("usage", {}))
    return data


def image_part(path):
    return {"type": "input_image", "image_url": "data:image/png;base64," + base64.b64encode(Path(path).read_bytes()).decode()}


def log(folder, **entry):
    with open(Path(folder) / "steps.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"time": round(time.time(), 1), **entry}, default=str)[:20000] + "\n")


def usage_of(data):
    usage = data.get("usage", {}) or {}
    return {"input": usage.get("input_tokens", 0), "cached": (usage.get("input_tokens_details") or {}).get("cached_tokens", 0),
            "output": usage.get("output_tokens", 0), "total": usage.get("total_tokens", 0)}


class Results:
    """Long tool results, stored whole and handed to the agent short, with a reference."""

    def __init__(self, folder):
        self.folder = Path(folder) / "results"
        self.folder.mkdir(parents=True, exist_ok=True)
        self.count = len(list(self.folder.glob("r*.txt")))

    def short(self, text):
        if len(text) <= SHORT_LIMIT:
            return text
        self.count += 1
        ref = f"r{self.count}"
        (self.folder / f"{ref}.txt").write_text(text, encoding="utf-8")
        return f"{text[:HEAD]}\n... [{len(text) - HEAD - TAIL} characters shortened; full text: recall('{ref}')] ...\n{text[-TAIL:]}"

    def recall(self, ref):
        path = self.folder / f"{str(ref).strip()}.txt"
        return path.read_text(encoding="utf-8") if path.exists() else f"No stored result named {ref!r}."


INSPECT_TOOLS = {"docs", "show", "render", "recall"}   # looking, not building: not counted in max_steps
MAX_INSPECTIONS = 40                                    # their own limit, so a run cannot go on forever looking
DIAGNOSE = ("Diagnose before switching: read the error, check your assumptions, and make a focused fix to what it names. "
            "Do not rerun the same code unchanged, and do not drop a workable approach after one failure.")
CAD_WORDS = ("loft", "shell", "fillet", "brep", "stdfail", "standard_", "not a valid solid", "boolean", "offset")


HELPER_FILES = ("body_parts.py", "case_parts.py", "case_checks.py", "checks.py", "body_rules.py", "case_agent.py", "body_agent.py")   # shared code the agents call or are checked by
REFUSALS = ("Not accepted", "Nothing has", "Nothing to", "The saved script changed", "There is no script",
            "It ran but did not export", "Import of", "Unknown tool", "Inspection limit")
TOOL_FAILURE_LIMIT = 2   # the same shared-tool failure twice (one focused retry) stops the run as blocked by tool


def crash_cause(text):
    """What a crash was: its exception, the shared helper it failed in and the operation inside it, and whose fault it
    is ("tool": a shared building block broke; "script": the agent's own code, or a helper refusing its values).
    None if the text is not a crash."""
    if not text.startswith("The code crashed"):
        return None
    lines = [l for l in text.splitlines() if l.strip()]
    error = next((l.strip() for l in reversed(lines) if re.match(r"^\s*[A-Za-z_.]*(Error|Exception)\b", l)), lines[-1].strip())
    kind = error.split(":", 1)[0].strip()
    frames = re.findall(r'File "([^"]+)", line (\d+), in (\S+)', text)
    names = [(Path(f.replace("\\", "/")).name, int(n), fn) for f, n, fn in frames]
    at = None
    for i, l in enumerate(lines):
        found = re.search(r'File ".*design\.py", line (\d+)', l)
        if found:
            at = f"line {found.group(1)}: " + (lines[i + 1].strip() if i + 1 < len(lines) else "")
    helpers = [fn for name, _, fn in names if name in HELPER_FILES]
    deepest = names[-1] if names else None
    helper = helpers[0] if helpers else None
    operation = deepest[2] if deepest else None
    # a helper that raises AssertionError / ValueError itself is refusing the values it was given: the script's to fix
    refused = deepest is not None and deepest[0] in HELPER_FILES and kind in ("AssertionError", "ValueError")
    source = "tool" if helper and not refused else "script"
    if "RunStoppedError" in text:
        # the run died before printing anything (out of memory, a killed process): the machine, not the script
        kind, helper, operation, source = "RunStoppedError", "sandbox", "start", "tool"
        error = next((l.strip() for l in lines if "exit code" in l), error)
    return {"type": kind, "error": error[:400], "helper": helper, "operation": operation, "source": source, "at": at}


def failure_view(text):
    """A crash as the agent's next decision should see it: what failed, where in its file, whose fault it is and what
    to try, marked {"ok": false, "kind": "crash"}. None if the result is not a crash."""
    cause = crash_cause(text)
    if cause is None:
        return None
    error = cause["error"]
    if cause["source"] == "tool":
        tries = [f"{cause['helper']} failed inside {cause['operation']} ({cause['type']}): this is a fault in the shared "
                 "building block, not in your script, so editing the calling line will not repair it.",
                 "Get the same result another way: a different block, or different settings or features for this one.",
                 f"If the same failure comes back once more, the run stops as blocked by this tool."]
    elif any(w in text.lower() for w in CAD_WORDS) and not error.startswith(("AssertionError", "ValueError")):
        tries = ["Build that part with a body_parts block (superblob, spine_body, soft_box, grow, ...): they accept "
                 "any settings and print a note when they had to change something.",
                 "If it is your own loft or fillet: change the sections more gradually or use a smaller radius."]
    elif error.startswith(("AssertionError", "ValueError")):
        tries = ["The message names what to change, often by how many mm: change that value."]
    else:
        tries = ["Fix the line named above; check its inputs with measure() if you are not sure."]
    return json.dumps({"ok": False, "kind": "crash", "source": cause["source"], "error": error, "helper": cause["helper"],
                       "operation": cause["operation"], "at": cause["at"], "try": tries + [DIAGNOSE], "trace": text[-900:]})


def marked(text):
    """Every failed result carries the same mark, {"ok": false, "kind": ...}, so the agent (and the log) can tell a
    failure from a result at a glance: crashes, failed rules or checks, and refusals. Other results are unchanged."""
    view = failure_view(text)
    if view:
        return view
    if text.startswith(REFUSALS):
        kind = "limit" if text.startswith("Inspection limit") else "refused"
        return json.dumps({"ok": False, "kind": kind, "source": "script", "message": text})
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return text
    if isinstance(data, dict) and data.get("failed") and not data.get("passed") and "ok" not in data:
        return json.dumps({"ok": False, "kind": "rule", **data}, default=str)
    return text


def failed(text):
    """True for any marked failure, a crash, or a check/submit that names failures."""
    if text.startswith("The code crashed"):
        return True
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return False
    return isinstance(data, dict) and (data.get("ok") is False or (bool(data.get("failed")) and not data.get("passed")))


def save_tool_bug(folder, cause, code, text):
    """The exact script that broke a shared helper, kept as a regression case for that helper."""
    bugs = Path(folder) / "tool_bugs"
    bugs.mkdir(parents=True, exist_ok=True)
    n = len(list(bugs.glob(f"{cause['helper']}-*.py"))) + 1
    path = bugs / f"{cause['helper']}-{n}.py"
    head = "\n".join(f"# {l}" for l in [f"{cause['helper']} failed inside {cause['operation']}: {cause['error']}",
                                         "Regression case: this script must build once the helper is fixed."])
    path.write_text(head + "\n" + (code or "") + "\n", encoding="utf-8")
    (bugs / f"{cause['helper']}-{n}.trace.txt").write_text(text, encoding="utf-8")
    return path


def result_label(best, target, reviewed=True):
    """The honest result: done only when every rule passes and the look reaches the target; a working result under
    the target is a draft for inspection, never a finished enclosure."""
    if not best:
        return "failed"
    if best.get("unfinished"):
        return f"draft: fits, unfinished details: {', '.join(best['unfinished'])}"
    if reviewed and (best.get("score") or 0) < target:
        return f"draft: fits, look goal not met ({best.get('score') or 0}/10)"
    return "done"


def save_state(folder, shop, **counters):
    """Everything needed to continue after a crash, written after every step."""
    state = {**counters, "shop": shop.state() if hasattr(shop, "state") else {}}
    path = Path(folder) / "state.json"
    path.with_suffix(".tmp").write_text(json.dumps(state, indent=1, default=str), encoding="utf-8")
    path.with_suffix(".tmp").replace(path)


def load_state(folder):
    path = Path(folder) / "state.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def run(shop, instructions, brief, folder, picture=None, max_steps=40, max_submits=4, label="agent", resume=False):
    """Runs the agent until the shop's best is good enough or a budget ends. Returns (outcome, steps, tokens, seconds).
    resume=True continues a stopped run from its state.json."""
    folder = Path(folder)
    started, steps, tokens, calls_made, chains = time.time(), 0, 0, 0, 1
    tools = [*shop.tools, RECALL]
    store = Results(folder)
    summary, latest, nudges = None, [], 0
    inspections, seen = 0, {}
    tool_failures, blocked = {}, None
    earlier = load_state(folder) if resume else None
    if earlier:
        steps, tokens, calls_made, nudges = earlier["steps"], earlier["tokens"], earlier["model_calls"], earlier["nudges"]
        inspections = earlier.get("inspections", 0)
        chains, summary, latest = earlier["chains"] + 1, earlier.get("summary"), earlier.get("latest", [])
        if hasattr(shop, "restore"):
            shop.restore(earlier["shop"])
        log(folder, step=steps, resumed=True, chain=chains)

    def ask(body, previous=None):
        nonlocal tokens, calls_made
        data = call(tools, body, previous)
        calls_made += 1
        used = usage_of(data)
        tokens += used["total"]
        log(folder, model=calls_made, chain=chains, step=steps, **used)
        return data

    def opening(extra=()):
        content = [{"type": "input_text", "text": brief}, *extra]
        if picture:
            content.append(image_part(picture))
        return {"instructions": instructions, "input": [{"role": "user", "content": content}]}

    if earlier:
        code = getattr(shop, "code", None)
        best = shop.best
        facts = (f"You are resuming a run that stopped after step {steps}. Submits used: {shop.submits} of {max_submits}. "
                 + (f"Best passing result so far: {best['score']}/10 (kept). " if best else "Nothing has passed yet. ")
                 + "The saved script is below; run it first, then carry on.")
        extra = [{"type": "input_text", "text": facts}]
        if summary:
            extra.append({"type": "input_text", "text": "Your last handoff summary:\n" + summary})
        extra += [{"type": "input_text", "text": "The current file:\n```python\n" + (code or "(none yet)") + "\n```"},
                  {"type": "input_text", "text": "The latest tool results:\n" + "\n\n".join(latest)[-4000:]}]
        data = ask(opening(extra))
    else:
        data = ask(opening())
    while True:
        calls = [item for item in data["output"] if item["type"] == "function_call"]
        said = "".join(c.get("text", "") for item in data["output"] if item["type"] == "message" for c in item["content"])
        if said:
            log(folder, step=steps, said=said[:2000])
        if not calls:
            # Stopping short of the goal while budget is left: send it back once or twice with what to do next.
            left = shop.submits < max_submits and steps < max_steps
            if left and nudges < MAX_NUDGES and not (shop.best and shop.done()):
                nudges += 1
                fixes = getattr(shop, "last_fixes", []) or []
                if shop.best:
                    text = (f"Your best passing result scores {shop.best['score']}/10 and the target is {getattr(shop, 'target', 8)}. "
                            "Keep going: make the reviewer's most important change, check it, and submit again. "
                            "The best pass is kept, so trying cannot make the result worse.")
                else:
                    text = "Nothing has passed yet. Keep going: fix what the last check or submit named, then submit."
                if fixes:
                    text += "\nThe reviewer's fixes, most important first:\n" + "\n".join(f"- {f}" for f in fixes[:3])
                log(folder, step=steps, nudge=text)
                data = ask({"input": [{"role": "user", "content": [{"type": "input_text", "text": text}]}]}, previous=data["id"])
                continue
            outcome = (shop.best["status"] if shop.best else "stopped: the agent stopped calling tools")
            break
        results, pictures, latest = [], [], []
        for item in calls:
            arguments = json.loads(item.get("arguments") or "{}")
            began = time.time()
            free = item["name"] in INSPECT_TOOLS and inspections < MAX_INSPECTIONS   # a look that costs no build step
            looking = item["name"] in INSPECT_TOOLS
            key = (item["name"], json.dumps(arguments, sort_keys=True), getattr(shop, "code", None))
            if looking and not free:
                text, picture_out = (f"Inspection limit reached ({MAX_INSPECTIONS} docs/show/render/recall calls). "
                                     "Build, edit, check or submit instead."), None
            elif item["name"] == "recall":
                text, picture_out = store.recall(arguments.get("ref", "")), None
            else:
                text, picture_out = shop.execute(item["name"], arguments)
            if getattr(shop, "uncounted", False):
                # the call did nothing (nothing current to check, the same submit again): an inspection, not a step
                shop.uncounted = False
                free = looking = inspections < MAX_INSPECTIONS
            repeat = not looking and failed(text) and seen.get(key, (None, None))[1] == text
            if free:
                inspections += 1
            elif not repeat:
                steps += 1   # a build, check or submit, or a look past the inspection limit
            if repeat:
                # the same call on the same file gave the same failure: say so, and do not count it as a try
                text = json.dumps({"ok": False, "error": f"Same call, same file, same failure as step {seen[key][0]}.",
                                   "try": ["Change the file or the arguments first: the failure below will not change by itself.", DIAGNOSE],
                                   "failure": text[-1500:]})
            elif not looking and failed(text):
                seen[key] = (steps, text)
            cause = crash_cause(text) if not looking else None
            raw = text
            text = marked(text)
            if cause and cause["source"] == "tool":
                key = (cause["type"], cause["helper"], cause["operation"])
                tool_failures[key] = tool_failures.get(key, 0) + 1
                if tool_failures[key] >= TOOL_FAILURE_LIMIT and not blocked:
                    bug = save_tool_bug(folder, cause, getattr(shop, "code", None), raw)
                    blocked = (f"blocked by tool: {cause['helper']} failed inside {cause['operation']} "
                               f"({cause['type']}) {tool_failures[key]} times; regression case {bug.name}")
                    print(f"TOOL BUG {blocked}", flush=True)
            # a failure is sent whole: the next decision needs the reason, not a reference to it
            sent = text if item["name"] == "recall" or failed(text) else store.short(text)
            log(folder, step=steps, inspections=inspections, tool=item["name"], arguments=arguments, result=text[:3000],
                sent_chars=len(sent), repeat=repeat or None, seconds=round(time.time() - began, 1))
            print(f"{label} step {steps}: {item['name']} {text[:160]!r}", flush=True)
            results.append({"type": "function_call_output", "call_id": item["call_id"], "output": sent})
            latest.append(f"{item['name']}: {sent}")
            if picture_out:
                pictures.append(picture_out)
        save_state(folder, shop, steps=steps, tokens=tokens, model_calls=calls_made, nudges=nudges, chains=chains,
                   summary=summary, latest=latest, label=label, inspections=inspections)
        follow = list(results)
        if pictures:
            parts = [{"type": "input_text", "text": "The concept, then yours:"}]
            if picture:
                parts.append(image_part(picture))
            parts += [image_part(p) for p in pictures]
            follow.append({"role": "user", "content": parts})
        best = shop.best
        outcome = None
        if blocked:
            # a shared tool is broken: stop rather than spend the rest of the run around it; the best pass is kept
            outcome = blocked
        elif best and shop.done():
            outcome = best["status"] or "passed"
        elif shop.submits >= max_submits:
            outcome = best["status"] if best else "stopped: used all submits"
        elif steps >= max_steps:
            outcome = best["status"] if best else f"stopped: used all {max_steps} steps"
        elif agent.job_out_of_tokens():
            outcome = best["status"] if best else agent.token_limit_reason()
        if outcome:
            break
        if steps >= max_steps - 3:
            follow.append({"role": "user", "content": [{"type": "input_text", "text": "Only a few steps are left: submit your best now."}]})
        if COMPACT_AT and usage_of(data)["input"] >= COMPACT_AT:
            # Hand off: the agent summarises, then a fresh chain starts from the summary, the file and the latest results.
            closing = ask({"input": follow + [{"role": "user", "content": [{"type": "input_text", "text": HANDOFF}]}], "tool_choice": "none"}, previous=data["id"])
            summary = "".join(c.get("text", "") for item in closing["output"] if item["type"] == "message" for c in item["content"])[:SUMMARY_LIMIT]
            save_state(folder, shop, steps=steps, tokens=tokens, model_calls=calls_made, nudges=nudges, chains=chains + 1,
                       summary=summary, latest=latest, label=label)
            chains += 1
            log(folder, step=steps, compacted=True, chain=chains, summary=summary)
            code = getattr(shop, "code", None)
            extra = [{"type": "input_text", "text": "You are continuing earlier work. Your handoff summary:\n" + summary},
                     {"type": "input_text", "text": "The current file:\n```python\n" + (code or "(none yet)") + "\n```"},
                     {"type": "input_text", "text": "The latest tool results:\n" + "\n\n".join(latest)[-4000:]}]
            extra += [image_part(p) for p in pictures]
            data = ask(opening(extra))
            continue
        data = ask({"input": follow}, previous=data["id"])
    log(folder, step=steps, finished=outcome, model_calls=calls_made, chains=chains, tokens=tokens)
    return outcome, steps, tokens, round(time.time() - started, 1)
