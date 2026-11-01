"""One look check: the AI compares a passed design's render with its concept picture, once. It reports only. It never fails a design and never starts a retry by itself."""
import base64
import json
import re
import sys
import urllib.request
from pathlib import Path

from agent import MODEL, api_key, send_with_retries

PROMPT = """The first image is the concept picture for a 3D-printed case. The second shows the real design from four angles: front, straight on, side and back.
Different shades of cream only mark separate parts, and the dark area is the real screen board. Ignore colours and whatever is drawn on the screen. The real screen's shape may differ from the picture, so ignore that too.
Judge only the body: silhouette, proportions, how soft the edges are, and whether it reads as one object. Reply with only JSON:
{"score": <0 to 10, where 10 is a clear match>, "differences": ["<up to 3 short, concrete changes that would bring it closer, most important first>"]}"""


def data_url(path):
    return "data:image/png;base64," + base64.b64encode(Path(path).read_bytes()).decode()


def look_check(picture, attempt):
    attempt = Path(attempt)
    content = [{"type": "input_text", "text": PROMPT}, {"type": "input_image", "image_url": data_url(picture)}, {"type": "input_image", "image_url": data_url(attempt / "preview.png")}]
    body = json.dumps({"model": MODEL, "input": [{"role": "user", "content": content}], "reasoning": {"effort": "low"}}).encode()
    request = urllib.request.Request("https://api.openai.com/v1/responses", data=body, headers={"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"})
    data = send_with_retries(request)
    reply = "".join(c.get("text", "") for item in data["output"] if item["type"] == "message" for c in item["content"])
    match = re.search(r"\{.*\}", reply, re.S)
    result = json.loads(match.group(0)) if match else {"score": None, "differences": [], "unreadable_reply": reply[:500]}
    result["tokens"] = data.get("usage", {}).get("total_tokens")
    (attempt / "look.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    return result


if __name__ == "__main__":
    print(json.dumps(look_check(sys.argv[1], sys.argv[2]), indent=1))
