"""Concept picture for a case. The screen's shape comes from the part card, and results are saved so a repeat costs nothing."""
import base64
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from agent import api_key
from card import build_card

HERE = Path(__file__).resolve().parent
FOLDER = HERE / "runs" / "concepts"
MODEL = "gpt-image-2"
TEMPLATE = ("Product concept render of a small 3D-printable desk device, seen from the front and slightly to one side. The look: {look}. "
            "The one working feature on the front is a single flat rectangular screen, {wide} mm wide and {tall} mm tall, with its long side {orientation}. "
            "The screen is the main feature and spans at least half of the front's width, inside a slim even bezel. The whole device is only about {case_wide} mm wide, so it is compact and chunky. "
            "One matte plastic colour with a dark screen, showing a simple friendly picture. Soft studio light, plain light background. "
            "A simple solid one-piece body with a flat bottom and softened edges, no thin parts, no text, no logos, no fake buttons, and no cables.")


def picture_prompt(part_id, look, landscape=True):
    size = build_card(part_id)["features"]["screen"]["size"]
    short, long = sorted(size[:2])
    wide, tall = (long, short) if landscape else (short, long)
    return TEMPLATE.format(look=look, wide=round(wide), tall=round(tall), orientation="horizontal" if landscape else "vertical", case_wide=round(wide / 0.6))


def concept(part_id, look, landscape=True):
    prompt = picture_prompt(part_id, look, landscape)
    path = FOLDER / f"{hashlib.sha256((MODEL + prompt).encode()).hexdigest()[:12]}.png"
    if path.exists():
        return path
    FOLDER.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"model": MODEL, "prompt": prompt, "size": "1024x1024", "quality": "medium", "n": 1}).encode()
    request = urllib.request.Request("https://api.openai.com/v1/images/generations", data=body, headers={"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=300) as response:
        data = json.load(response)
    path.write_bytes(base64.b64decode(data["data"][0]["b64_json"]))
    path.with_suffix(".json").write_text(json.dumps({"prompt": prompt, "model": MODEL, "usage": data.get("usage")}, indent=1), encoding="utf-8")
    return path


if __name__ == "__main__":
    print(concept(sys.argv[1], sys.argv[2]))
