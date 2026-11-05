"""The shared agent loop for the body and case stages: the model calls tools, the tools act on a sandbox folder, and
every step goes to <folder>/steps.jsonl. A shop (the stage's tools) holds the state and the best accepted result.

A shop provides: tools (OpenAI function tool list), execute(name, arguments) -> (text, picture or None),
submits (int), best (dict with "score", "folder", "status") or None, and done() -> bool (the best is good enough).
Uniform tools: name + arguments in, text (and maybe a picture) out."""
import base64
import json
import time
import urllib.request
from pathlib import Path

import agent

GUIDES = Path(__file__).resolve().parent / "guides"


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


def run(shop, instructions, brief, folder, picture=None, max_steps=40, max_submits=4, label="agent"):
    """Runs the agent until the shop's best is good enough or a budget ends. Returns (outcome, steps, tokens, seconds)."""
    folder = Path(folder)
    started, steps, tokens = time.time(), 0, 0
    content = [{"type": "input_text", "text": brief}]
    if picture:
        content.append(image_part(picture))
    data = call(shop.tools, {"instructions": instructions, "input": [{"role": "user", "content": content}]})
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
            print(f"{label} step {steps}: {item['name']} {text[:160]!r}", flush=True)
            results.append({"type": "function_call_output", "call_id": item["call_id"], "output": text})
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
        data = call(shop.tools, {"input": follow}, previous=data["id"])
    return outcome, steps, tokens, round(time.time() - started, 1)
