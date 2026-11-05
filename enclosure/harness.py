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
  chain from the summary, the current file, the latest results and the concept picture (off until measured)."""
import base64
import json
import os
import time
import urllib.request
from pathlib import Path

import agent

GUIDES = Path(__file__).resolve().parent / "guides"
MAX_NUDGES = 2          # times the agent is sent back when it stops short of the goal with budget left
SHORT_LIMIT = 1500      # characters: a longer tool result is stored and shortened
HEAD, TAIL = 900, 300   # characters of a shortened result kept from its start and its end
COMPACT_AT = int(os.environ.get("ENCLOSURE_COMPACT_AT", 0))  # input tokens on one call; 0 = never compact
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


def run(shop, instructions, brief, folder, picture=None, max_steps=40, max_submits=4, label="agent"):
    """Runs the agent until the shop's best is good enough or a budget ends. Returns (outcome, steps, tokens, seconds)."""
    folder = Path(folder)
    started, steps, tokens, calls_made, chains = time.time(), 0, 0, 0, 1
    tools = [*shop.tools, RECALL]
    store = Results(folder)

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

    data = ask(opening())
    nudges = 0
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
            steps += 1
            arguments = json.loads(item.get("arguments") or "{}")
            began = time.time()
            if item["name"] == "recall":
                text, picture_out = store.recall(arguments.get("ref", "")), None
            else:
                text, picture_out = shop.execute(item["name"], arguments)
            sent = text if item["name"] == "recall" else store.short(text)
            log(folder, step=steps, tool=item["name"], arguments=arguments, result=text[:3000], sent_chars=len(sent), seconds=round(time.time() - began, 1))
            print(f"{label} step {steps}: {item['name']} {text[:160]!r}", flush=True)
            results.append({"type": "function_call_output", "call_id": item["call_id"], "output": sent})
            latest.append(f"{item['name']}: {sent}")
            if picture_out:
                pictures.append(picture_out)
        follow = list(results)
        if pictures:
            parts = [{"type": "input_text", "text": "The concept, then yours:"}]
            if picture:
                parts.append(image_part(picture))
            parts += [image_part(p) for p in pictures]
            follow.append({"role": "user", "content": parts})
        best = shop.best
        outcome = None
        if best and shop.done():
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
