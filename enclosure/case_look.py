"""Visual QA for a finished character case: an AI looks at each case try next to the concept and the frozen body, and
names what to fix, so every try gets closer to the look as well as passing the checks.
The AI only proposes: a listed feature it reports missing fails the try, and the case checks still decide the rest."""
import json
import re
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import agent
import review_facts
from look_check import data_url

DROP_LIMIT = 2   # a look score this far under the body's is a problem to fix, not noise (the reviewer is about +-1)

PROMPT = """You check how a finished 3D-printed case looks. Image 1 is the concept picture. Image 2 is the chosen body
(the outside the case must keep). Image 3 is the finished case from four angles (front, straight on, side, back), with
__PARTS__ in place. Ignore colours.
Design principles a good case follows:
- The silhouette and proportions match the concept; the case keeps the body's outside exactly.
- One consistent softness: every outer edge rounded alike; no sharp edges next to soft ones.
- The screen sits in an even, deliberate bezel; openings are sized and rounded to suit the form.
- Features (ears, arms, feet, antennas) are in proportion and grow out of the body, not stuck on.
- No screws, seams, bosses or patches showing on the front or the top.
- Details suit the character (a control shaped for it: a cap for a knob, a styled dimple for a touch button), and
  nothing looks unfinished.
Score anchors: 2 = a plain box; 3 = a box with stickers on; 5 = recognisable as the concept but crude;
7 = a good toy a shop would sell; 9 = a polished product with every principle met.
Judge the finished case against the concept and the body:
- Is each required feature still there and recognisable? A feature cut off, left loose or hidden counts as missing.
- What did the case add or change that spoils the look (a lump, a screw boss or seam showing on the front, a window,
  control or opening that clashes with the character, the body's softness lost)?
Reply with only JSON:
{"features": {"<feature name>": "present" | "weak" | "missing"}, "details": {"<detail id>": "done" | "not done"},
 "score": <0-10, 10 = reads clearly as the concept>,
 "fix": ["<up to 4 concrete changes to the case script, most important first, with where on the case>"]}
Required features:
"""


def sheet(picture, body_view, case_view, out, labels=("1 concept", "2 chosen body", "3 finished case")):
    images = [Image.open(p).convert("RGB") for p in (picture, body_view, case_view)]
    h = 420
    images = [i.resize((max(1, round(i.width * h / i.height)), h)) for i in images]
    board = Image.new("RGB", (max(i.width for i in images), 3 * (h + 36)), "white")
    draw = ImageDraw.Draw(board)
    try:
        font = ImageFont.truetype("arial.ttf", 24)
    except OSError:
        font = None
    for row, (label, image) in enumerate(zip(labels, images)):
        draw.text((10, row * (h + 36) + 6), label, fill=(0, 0, 0), font=font)
        board.paste(image, (0, row * (h + 36) + 36))
    board.save(out)
    return out


def ask(prompt, image):
    content = [{"type": "input_text", "text": prompt}, {"type": "input_image", "image_url": data_url(image)}]
    body = json.dumps({"model": agent.MODEL, "input": [{"role": "user", "content": content}], "reasoning": {"effort": "medium"}}).encode()
    request = urllib.request.Request("https://api.openai.com/v1/responses", data=body,
                                     headers={"Authorization": f"Bearer {agent.api_key()}", "Content-Type": "application/json"})
    data = agent.send_with_retries(request)
    agent.spend(data.get("usage", {}))
    reply = "".join(c.get("text", "") for item in data["output"] if item["type"] == "message" for c in item["content"])
    match = re.search(r"\{.*\}", reply, re.S)
    try:
        found = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        found = {}
    return found, data.get("usage", {}).get("total_tokens", 0)


def body_view(attempt):
    """A render of the frozen body, made once per case run and shared by its tries."""
    out = Path(attempt).parent / "body_view.png"
    if not out.exists():
        from body_stage import render
        from checks import load_stl
        render(load_stl(Path(attempt) / "BODY.stl"), out)
    return out


DETAILS_HEAD = """
Finishing details: judge each one on its own, only from image 3. "done" only if you can see it finished everywhere:
"""


def review(attempt, picture, base, body_score=None, details=None):
    """Looks at one case try. Returns {score, features, details, fix, problems}; problems are what fails the try.
    details: {id: question} the reviewer marks one by one (case_details); its marks are returned, never trusted alone."""
    attempt = Path(attempt)
    features = base.get("features") or []
    names = "\n".join(f"- {f['name']} ({f.get('where', '')})" for f in features) or "- (none listed)"
    board = sheet(picture, body_view(attempt), attempt / "preview.png", attempt / "look_sheet.png")
    # The real parts and limits, so the advice fits the hardware: a touch design has no knob, a full face cannot grow.
    size = None
    try:
        from checks import load_stl
        size = review_facts.body_size(load_stl(attempt / "BODY.stl"))
    except Exception:
        pass
    prompt = PROMPT.replace("__PARTS__", review_facts.parts_phrase(base)) + names
    if details:
        prompt += DETAILS_HEAD + "\n".join(f'- "{d}": {q}' for d, q in details.items())
    prompt += "\n\n" + review_facts.facts(base, size)
    found, tokens = ask(prompt, board)
    score = found.get("score") if isinstance(found.get("score"), (int, float)) else None
    marks = found.get("features") if isinstance(found.get("features"), dict) else {}
    detail_marks = found.get("details") if isinstance(found.get("details"), dict) else {}
    fixes = [str(f) for f in found.get("fix", []) if isinstance(f, str)][:4] if isinstance(found.get("fix"), list) else []
    fixes, dropped = review_facts.filter_fixes(fixes, base, size)
    problems = []
    def mark(name):
        # The reviewer may repeat the place after the name, as in "left arm (left side)".
        for key, value in marks.items():
            if key == name or key.split(" (")[0].strip() == name:
                return str(value).lower()
        return ""
    gone = [f["name"] for f in features if mark(f["name"]) == "missing"]
    if gone:
        problems.append(f"The finished case lost these features of the body: {', '.join(gone)}. Keep every feature joined to the Shell and visible.")
    if score is not None and body_score is not None and score <= body_score - DROP_LIMIT:
        problems.append(f"The finished case looks clearly worse than the chosen body ({score}/10 against {body_score}/10).")
    result = {"score": score, "features": marks, "details": {str(k): str(v) for k, v in detail_marks.items()}, "fix": fixes, "dropped_fixes": dropped, "problems": problems, "tokens": tokens}
    (attempt / "look.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    return result


def as_check(look):
    """The look review as a case check result, so it travels with the others into the next try's prompt."""
    return {"check": "look_review", "part": "case", "ok": not look["problems"], "measured": look["score"],
            "limit": "every listed feature still there, and the look not clearly worse than the body",
            "where": None, "fix": " ".join(look["problems"] + [f"Look fixes: {'; '.join(look['fix'])}" if look["fix"] else ""]).strip()}
