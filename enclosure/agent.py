"""The AI designer loop: the AI writes CAD code, our checks judge the files, and hard stop rules end the run."""
import base64
import json
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

import checks
from card import build_card, load_nodes
from parts import ensure_part
from sandbox import run_design

HERE = Path(__file__).resolve().parent
ENV_FILE = HERE.parent / ".env"
MODEL = "gpt-6.1-sol"
MAX_TRIES_PER_PART = 3
MAX_CASE_TRIES = 6
MAX_TOTAL_TRIES = 8
WORSE_BY = 3
MODEL_RETRIES = 4
MODEL_RETRY_WAIT_SECONDS = 20
PASSING_OUTCOMES = {"passed", "pass", "pass_with_warnings"}
MAX_CODE_FAILURES = 6
NO_PROGRESS_TRIES = 2
MAX_TOKENS = 400_000
MAX_SECONDS = 1800
OCCUPIED_MIN_SIZE = 2.0

SYSTEM = """You design 3D-printed parts by writing one complete Python script using build123d 0.13.
Reply with only the script, in one ```python block. Allowed imports: build123d, math, json, pathlib.

The script runs in an empty folder and must write:
- each printed part as an STL, for example export_stl(shape, "PRINT_Carrier.stl", tolerance=0.01). The shape must be one solid.
- design.json in exactly this form:
  {{"print": {{"PRINT_Carrier": "PRINT_Carrier.stl"}},
   "purchased": {{"PURCHASE_Board": {{"part_id": "<id>", "transform": <4x4 matrix in mm, move and rotate only>}}}},
   "holds": {{"PRINT_Carrier": {{"part": "PURCHASE_Board", "insert_from": "+z"}}}}}}

Everything is in millimetres. The purchased part's own coordinates are given. Its sizes are real and cannot change.

Fixed checks will measure your exported files. You cannot change them. A design passes only if:
- the printed part is sealed, one piece, and at most {thin:.0%} of its surface is thinner than {wall} mm
- every surface of the purchased part stays at least {gap} mm from the plastic, with no overlap. Aim for slightly more, such as 0.12 mm.
- the purchased part goes straight in from insert_from with no plastic in the way
- the part cannot move more than {travel} mm in any other direction, so it needs stops on all those sides
- the plastic stays out of each connector's plug path, which is described below

Use simple blocks and cut-outs. Look at the occupied boxes and leave room for all of them.
""".format(thin=checks.THIN_AREA_ALLOWED, wall=checks.MIN_WALL_CARRIER, gap=checks.MIN_GAP, travel=checks.MAX_TRAVEL)


SYSTEM = SYSTEM + "\n\n" + (HERE / "DESIGN_RULES.md").read_text(encoding="utf-8")


def api_key():
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("OPENAI_API_KEY="):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("OPENAI_API_KEY is not in .env")


def send_with_retries(request):
    """A short outage at the model provider must not end a whole run. Only server and rate-limit errors and dropped connections retry."""
    for attempt in range(MODEL_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500 or attempt == MODEL_RETRIES:
                raise
            print(f"model error {error.code}, waiting to retry", flush=True)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == MODEL_RETRIES:
                raise
            print(f"model connection problem: {error}, waiting to retry", flush=True)
        time.sleep(MODEL_RETRY_WAIT_SECONDS * (attempt + 1))


def ask_model(instructions, text, picture=None):
    content = text
    if picture:
        image = base64.b64encode(Path(picture).read_bytes()).decode()
        content = [{"role": "user", "content": [{"type": "input_text", "text": text}, {"type": "input_image", "image_url": f"data:image/png;base64,{image}"}]}]
    body = json.dumps({"model": MODEL, "instructions": instructions, "input": content, "reasoning": {"effort": "medium"}}).encode()
    request = urllib.request.Request("https://api.openai.com/v1/responses", data=body, headers={"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json"})
    data = send_with_retries(request)
    reply = "".join(c.get("text", "") for item in data["output"] if item["type"] == "message" for c in item["content"])
    return reply, data.get("usage", {})


def extract_code(reply):
    match = re.search(r"```(?:python)?\s*\n(.*?)```", reply, re.S)
    return match.group(1) if match else reply


def occupied_boxes(part_id):
    """Every sizeable solid on the part, measured from the model, so the AI can see what is behind the board."""
    boxes = []
    for mesh in load_nodes(ensure_part(part_id)).values():
        size = mesh.bounds[1] - mesh.bounds[0]
        if size.max() >= OCCUPIED_MIN_SIZE and size.min() > 0:
            boxes.append({"min": np.round(mesh.bounds[0], 2).tolist(), "max": np.round(mesh.bounds[1], 2).tolist()})
    return boxes


def carrier_brief(part_id):
    card = build_card(part_id)
    plug = {k: {**v, "plug_room": checks.PLUG_ROOM[v["connector"]]} for k, v in card["features"].items() if "connector" in v}
    return "\n".join([
        "Design PRINT_Carrier: a holder that locates this board from the sides and from behind. The board goes in from its front (+z).",
        "A separate shell will close over it later, so nothing needs to stop it coming back out toward +z.",
        "Keep the screen and glass side open. The pins and parts behind the board need free room, so do not close the rear with a floor.",
        f"part_id: {part_id}",
        f"Part card, measured from the real model: {json.dumps(card['envelope'])} {json.dumps(card['features'])}",
        f"A connector's plug starts at its mouth and runs straight outward, centred on the connector. Sizes: {json.dumps(plug)}",
        f"Occupied boxes on the part: {json.dumps(occupied_boxes(part_id))}",
    ])


def more_parts_brief(part_ids):
    """What a case with several wired parts adds: the other parts' real data, the compiler's wires, and the wiring checks' limits."""
    import case_checks as c
    import space_checks as s
    import wiring_checks as w
    lines = ["This case holds more than one part. PURCHASE_Board above is the controller. Add these to purchased and to the assembly list, each with its own transform. All are real, and their sizes cannot change."]
    for index, part_id in enumerate(part_ids[1:]):
        card = build_card(part_id)
        lines.append(f"PURCHASE_Part{index + 2}: part_id {part_id}. Part card, measured from the real model: {json.dumps(card['envelope'])} {json.dumps(card['features'])}. Occupied boxes: {json.dumps(occupied_boxes(part_id))}")
    lines.append("""Hold each extra part with posts, ledges or its own printed part. It must not move more than the limit either. Extra printed parts are allowed: name them PRINT_ and list them in print and in the assembly. Keep holds to the one PRINT_Carrier and PURCHASE_Board entry; the closed-case checks already measure how well the extra parts are held.
A wire joins each pair of pins below. These come from the electrical compiler and cannot change. Each pin takes a plug, and the wire leaves from the plug's back end, straight along the pin at first. All values are in that part's own coordinates, so convert them with the same transform you use for the part.""")
    for wire in w.wires_for(part_ids):
        pairs = []
        for end in (wire["from"], wire["to"]):
            plug = w.plug_local(end)
            pairs.append(f"{end['part_id']} pin {end['label']}: plug starts at {np.round(plug['start'], 2).tolist()}, plug back end at {np.round(plug['back'], 2).tolist()}, pointing {plug['normal'].tolist()}")
        lines.append(f"net {wire['net']}: " + "; ".join(pairs))
    lines.append(f"""Add to design.json: "wires": [{{"net": "<net>", "path": [[x, y, z], ...]}}], one per net, in world coordinates, starting and ending exactly on the two plug back ends. Compute them in the script from the same transforms.

The case must also pass these checks. All the sizes here are assumptions until real jumpers are measured:
- Plug room: no plastic and no other part inside each {w.PLUG['width']} x {w.PLUG['width']} x {w.PLUG['length']} mm plug. So leave space beyond the pin tips, and allow for the wire turning after that.
- Wire room: real jumpers are floppy, so the path you draw is only a guide. Keep it inside the case, side by side, away from plastic where you can. What must pass is that one open space at least about 3 mm wide links each pair of plug backs, big enough to hold all the wires at real jumper lengths. Do not close the space behind the parts with ribs or posts that cut it in two. The path must start and end on the plug backs and be at most {w.WIRE_MAX_LENGTH} mm long.
- Every opening is a closed hole fitted to its part, and nothing else may be open, including at the seam. Allowed: the window around the glass with at most the window gap; the USB plug room of {checks.PLUG_ROOM['usb-c']['width']} x {checks.PLUG_ROOM['usb-c']['height']} mm; the knob's bushing plus {w.KNOB_WALL_RING} mm; a {s.BUTTON_HOLE_DIAMETER} mm round pin hole for each button; and a {c.SCREW['driver_radius'] * 2} mm screwdriver path. If assembly truly needs the USB opening to reach the seam, keep that slot exactly plug-room wide and tall. Do not cut slots for buttons. A round hole across the wall does not block the Shell going on.
- Side buttons listed as buttons on a card need that clear hole straight out through every printed part, from the button's face in its press_from direction. The buttons are on the controller: {json.dumps(build_card(part_ids[0])['buttons'])}.
- The compact front rule still applies, but the case can grow in depth to fit the plugs. Most of the depth comes from the controller's pins plus the plugs and the turn after them.""")
    cards = [build_card(p) for p in part_ids]
    if any("touch" in c["features"] for c in cards):
        lines.append(f"""- Touch sensor opening: if a part has a touch feature, the case must have a real cut-out for it, planned from the start. Cut a clear {w.FINGER_WIDTH:.0f} mm wide opening over the middle of the touch feature's box, straight out from the side of the sensor that faces out, through every printed part. The finger touches the sensor itself through this opening; do not cover it with thin plastic. Put it where a person can see and reach it, on the front, top or a side, and not underneath or behind. Keep the opening inside the sensor's outline, so plastic stays all round it and still holds the sensor in. It must be shallow: at most {w.FINGER_MAX_DEPTH:.0f} mm from the sensor's face to the outside at the rim. may_face_out on the card lists the sides allowed to face out; read its note, because the pins matter here. Every plug must stay inside the case.""")
    if any("shaft" in c["features"] for c in cards):
        knob_card = next(c for c in cards if "shaft" in c["features"])
        if knob_card.get("pins_point") == knob_card["features"]["shaft"].get("points"):
            pins_advice = f"""- This part's pins point the same way as the shaft. Those plugs are {w.PLUG['length']:.0f} mm long and reach above the bushing's top, so a flat wall low enough for the knob will hit them. Plan for this from the start: for example a raised hump over the pins, or a recess around the knob in a higher wall. Do not bend or turn the pins; they stay as in the model. The wire must then turn inside the case."""
        else:
            pins_advice = f"""- This part's pins point {knob_card.get('pins_point')} in its own coordinates, sideways in the board's plane and past the board's edge, not along the shaft. Each {w.PLUG['length']:.0f} mm plug continues that way, and the wire must then turn inside the case. So turn the part so that those plugs and the turn have room inside the body. Do not bend or turn the pins any further."""
        lines.append(f"""Knob on a shaft: the card's shaft, bushing and knob boxes are real, and the knob is fitted last, after the case is closed, so it does not need to pass through the hole during assembly. The checks:
- The shaft comes out through a closed hole in a wall, with plastic all round the bushing, up to {w.KNOB_WALL_RING} mm from it, at a level below the knob's base. Nothing blocks the shaft's path. The hole may be split across a seam.
- The knob's base sits outside or in a recess: the knob must clear the plastic by the usual gap.
- Finger room, assumed: the top {w.KNOB_EXPOSED:.0f} mm of the knob stands clear with {w.KNOB_FINGER_ROOM:.0f} mm of free space all round, and {w.KNOB_ROOM_ABOVE:.0f} mm above it.
- Not on the desk side and not on the far side from the screen. The top or a side works well.
- Pressing the knob pushes the board straight back: plastic stops within {w.PRESS_MAX_GAP} mm behind its PCB, surrounding the shaft by at least {w.PRESS_SUPPORT_MARGIN:.0f} mm on all sides, avoiding its solder tails and pins. No wire within {w.PRESS_WIRE_DEPTH:.0f} mm behind that PCB. The board also must not rotate or move more than the limit.
{pins_advice}""")
    return "\n".join(lines)


def case_brief(part_ids, look, carrier_code):
    import case_checks as c
    part_id = part_ids[0]
    extra = [more_parts_brief(part_ids)] if len(part_ids) > 1 else []
    return "\n\n".join(extra + [carrier_brief(part_id), "A working Carrier script already exists:\n```python\n" + carrier_code + "\n```", f"""Now extend that script into a complete desk case with three printed parts: PRINT_Carrier, PRINT_Shell and PRINT_Base. Reply with one complete script that writes all three.
The look: {look}. Make it look like a designed product, with clean proportions and softened outer edges where you safely can. The screen is the main feature of the front.

How to build it so the parts stay valid:
- Everything goes together along the screen's axis, never across it, because the window's rim sits in front of the glass and would hit it. With the screen facing -y: the Shell is the front, top, sides and bottom, and comes on from -y. The Base is a rear cover that comes on from +y, with screws driven from the back (drive_from +y). So the seam is a flat plane parallel to the screen, and the assembly is Carrier, then Board from -y, then Shell from -y, then Base from +y. Use insert_from -y in holds, with the Carrier turned so it holds the board from behind.
- The window is a closed opening all round the glass, with no slot. The rim sits in front of the board's frame with a {checks.MIN_GAP + 0.05:.2f} mm gap, which stops the board moving forward. The Base or stops on it hold the Carrier from behind.
- Make one outer body first as a single solid. Make the cavity from the same outline, inset by the wall thickness, and leave {checks.MIN_GAP + 0.05:.2f} mm at the seam. Add posts, stops and ribs so each overlaps its wall by at least 1 mm, so nothing floats. Nothing on the inside of the Shell may overhang the path of the parts behind it.
- Before exporting, the script must check each part with assert len(part.solids()) == 1. A failed assert is a quick, cheap error for you to fix.
- Avoid slivers: every wall, rib and leftover strip of plastic must be at least {checks.MIN_WALL_CASE} mm thick on Shell and Base. When a cut leaves a thin strip, remove the strip completely.
- Simplest reliable layout: the screen stands upright facing -y, the board is turned so the USB faces a side, and the plug path leaves through a fitted opening in the side wall of the Shell.

World +z is up and the case sits on a desk at its lowest z. Turn the board and Carrier together however you need; the transform in design.json must match. Export every part in its final assembled position.
Add this to design.json, next to print, purchased and holds:
"case": {{"assembly": [{{"add": "PRINT_Carrier"}}, {{"add": "PURCHASE_Board", "from": "<direction it comes from, such as -y>"}}, {{"add": "PRINT_Shell", "from": "..."}}, {{"add": "PRINT_Base", "from": "..."}}],
"screws": [{{"head_at": [x, y, z], "drive_from": "+y", "through": "PRINT_Base", "into": "PRINT_Shell"}}]}}
List parts in the order they are put together. Directions are world axes: +x, -x, +y, -y, +z or -z. Keep holds, using an insert_from world axis that is straight along the board's insertion. So the board must sit square to a world axis for insertion and assembly to work, unless the case is tilted by a separate stand shape around it.

The closed case must also pass these checks:
- Shell and Base walls: at most {checks.THIN_AREA_ALLOWED:.0%} of the surface thinner than {checks.MIN_WALL_CASE} mm. Carrier: {checks.MIN_WALL_CARRIER} mm.
- Every pair of printed parts at least {checks.MIN_GAP} mm apart with no overlap, and every printed part at least {checks.MIN_GAP} mm from the board.
- In the closed case the board and the Carrier each move at most {checks.MAX_TRAVEL} mm in all six directions. Everything that holds them must be plastic.
- Each part reaches its place in a straight line past what is already placed.
- The plug path stays clear through every printed part and stays above the desk.
- Window: fits around the glass with at most {c.MAX_WINDOW_GAP} mm gap, measured at 0.1 mm below the glass face, so the plastic reaches that level all round. Nothing covers the screen from {c.VIEW_ANGLE} degrees off centre.
- Screen size: the active screen spans at least {c.MIN_SCREEN_SHARE_WIDEST} of the case front one way and {c.MIN_SCREEN_SHARE_OTHER} the other, so keep the front compact.
- The screen faces between -5 and {c.MAX_SCREEN_TILT_UP} degrees above horizontal.
- It stands: flat base, centre of weight at least {c.MIN_BALANCE_MARGIN} mm inside the footprint.
- At least {c.MIN_SCREWS} screws, each an assumed M2 x {c.SCREW['length']:.0f} self-tapping. head_at is the point on the axis where the underside of the head sits. From there along the screw: a clear {c.SCREW['shank_radius'] * 2} mm hole for {c.SCREW['length'] - c.SCREW['grip']:.0f} mm through every part, then {c.SCREW['grip']:.0f} mm of {c.SCREW['pilot_radius'] * 2} mm pilot hole inside a solid post at least {c.SCREW['post_radius'] * 2} mm wide. At least 1 mm of the through part under the {c.SCREW['head_radius'] * 2} mm head, and a {c.SCREW['driver_radius'] * 2} mm wide clear path for {c.SCREW['driver_length']:.0f} mm for the screwdriver. Keep screws away from the board."""] + extra)


def failure_text(ok, message, report):
    if not ok:
        return message
    fields = ("check", "part", "measured", "limit", "where", "fix")
    return json.dumps({"must_fix": [{k: r[k] for k in fields} for r in report["failed"]], "improve_if_you_can": [{k: r[k] for k in fields} for r in report.get("warnings", [])][:12]}, indent=1, default=str)


def signature(report):
    return sorted((r["check"], r["part"], str(r["limit"])) for r in report["failed"])


def stop_reason(history, tokens, started):
    """Why the loop must stop now, or None. These rules are the only thing that ends a failing run."""
    last = history[-1]
    if tokens >= MAX_TOKENS:
        return f"used {tokens} tokens, limit {MAX_TOKENS}"
    if time.time() - started >= MAX_SECONDS:
        return f"ran past {MAX_SECONDS} seconds"
    if len(history) >= 2:
        previous = history[-2]
        if last["ran"] and previous["ran"]:
            if signature(last["report"]) == signature(previous["report"]):
                same = {(r["check"], r["part"], str(r["limit"])): r["measured"] for r in previous["report"]["failed"]}
                if all(same[(r["check"], r["part"], str(r["limit"]))] == r["measured"] for r in last["report"]["failed"]):
                    return "same failure twice"
            if last["report"].get("complete", True) and previous["report"].get("complete", True) and len(last["report"]["failed"]) >= len(previous["report"]["failed"]) + WORSE_BY:
                return f"getting worse: {WORSE_BY} or more extra checks failed than the try before"
    counts = [len(h["report"]["failed"]) for h in history if h["ran"] and h["report"].get("complete", True)]
    if len(counts) > NO_PROGRESS_TRIES and min(counts[-NO_PROGRESS_TRIES:]) >= min(counts[:-NO_PROGRESS_TRIES]):
        return f"no progress: {NO_PROGRESS_TRIES} tries in a row without fewer failed checks than the best so far"
    return None


def retry_text(brief, code, failures):
    return "\n\n".join([brief, "Your last script:\n```python\n" + code + "\n```", "It failed. Fix these problems and reply with the complete corrected script:", failures])


def draw(attempt):
    """A picture of each try for the live page. A drawing problem must never stop a run."""
    try:
        from preview import render
        from viewer import build
        render(attempt)
        build(attempt)
    except Exception as error:
        print(f"no preview: {error}", flush=True)


PICTURE_BRIEF = """The attached concept picture shows the look to aim for. Match its silhouette, its proportions, how soft its corners are and its even bezel, as closely as the checks allow. Softened outer edges are the main thing that makes it look designed, so use large fillets on the outer body, shrinking them only where a wall or the seam needs it. Fillet the outer body before cutting anything, and give the cavity matching rounded corners so the wall stays even. Round the front face's outer edge and the back's too, by at least 3 mm where the wall allows, so the body looks soft from every side and not like a rounded outline pushed straight back.
The picture is only a look. Sizes and the screen's real shape come from the part card, so where they differ the part card wins, and the body proportions adapt around the real screen. Ignore the colours and the picture on the screen."""


def base_brief(base):
    """The decided design. The AI's job is to make the parts fit it, not to redesign it."""
    limits = [f"Width / height of the case front: {base['width_to_height'][0]} to {base['width_to_height'][1]}.", f"Depth: at most {base['max_depth']} mm."]
    for name, rule in base["place"].items():
        limits.append(f"{name} {rule['feature']}: its centre from {rule['across'][0]} to {rule['across'][1]} across the front, measured from the -x side.")
    return "\n".join([f"THE BASE DESIGN IS DECIDED: {base['name']}. It overrides every layout suggestion above, including where the knob goes. Do not redesign it. Your job is to make all the parts, wires and screws fit inside it. Everything else in this brief still has to pass.", *[f"- {line}" for line in base["sheet"]], "These are checked on your files:", *[f"- {line}" for line in limits],
                      "- Wires: side by side where you can, and no point on a wire can see straight out of the case except through a fitted opening."])


def crash_key(message):
    """The last line of a crash or timeout, so the same failure repeating can be spotted."""
    lines = [line for line in message.strip().splitlines() if line.strip()]
    return lines[-1] if lines else ""


def design_part(brief, folder, max_tries=MAX_TRIES_PER_PART, stage="carrier", continue_from=None, picture=None, base=None, body_stl=None):
    """Runs tries until the design passes or a stop rule fires. Every try is saved. continue_from is an earlier try's folder, to pick up where it left off.
    Only code that ran counts against max_tries; crashes and timeouts have their own small budget. Each new try starts from the best script so far, so one bad rewrite cannot lose what worked."""
    folder = Path(folder)
    history, tokens, started = [], 0, time.time()
    text = brief
    best = None
    if continue_from:
        earlier = Path(continue_from)
        report = checks.check_design(earlier, stage)
        best = {"code": (earlier / "design.py").read_text(encoding="utf-8"), "report": report, "failed": len(report["failed"])}
        text = retry_text(brief, best["code"], failure_text(True, "", report))
    while True:
        attempt = folder / f"try-{len(history) + 1}"
        attempt.mkdir(parents=True, exist_ok=True)
        (attempt / "prompt.txt").write_text(text, encoding="utf-8")
        began = time.time()
        if body_stl:
            # Ready before the code runs, so the script can load the frozen body rather than rebuild it.
            shutil.copy(Path(body_stl).with_suffix(".step"), attempt / "BODY.step")
        reply, usage = ask_model(SYSTEM, text, picture) if picture else ask_model(SYSTEM, text)
        tokens += usage.get("total_tokens", 0)
        code = extract_code(reply)
        ran, message = run_design(code, attempt)
        if base:
            # Written after the code runs, so the design cannot replace the rules it is checked against.
            (attempt / "base_design.json").write_text(json.dumps(base, indent=1), encoding="utf-8")
        if body_stl:
            shutil.copy(body_stl, attempt / "BODY.stl")
        report = checks.check_design(attempt, stage) if ran else {"passed": False, "failed": [], "results": []}
        (attempt / "report.json").write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")
        if ran and stage == "case":
            draw(attempt)
        history.append({"try": len(history) + 1, "ran": ran, "message": message, "report": report, "usage": usage, "seconds": round(time.time() - began, 1)})
        print(f"try {len(history)}: ran={ran} passed={report['passed']} status={report.get('status')} failed={[r['check'] for r in report['failed']]} tokens={usage.get('total_tokens')} {history[-1]['seconds']}s", flush=True)
        if report["passed"]:
            return summary(folder, history, tokens, started, report.get("status") or "passed")
        real = [h for h in history if h["ran"]]
        code_failures = [h for h in history if not h["ran"]]
        if ran and report.get("complete", True) and (best is None or len(report["failed"]) < best["failed"]):
            best = {"code": code, "report": report, "failed": len(report["failed"]), "try": len(history)}
        elif ran and best is None:
            best = {"code": code, "report": report, "failed": 10 ** 6, "try": len(history)}
        reason = None
        if len(real) >= max_tries:
            reason = f"used all {max_tries} tries"
        elif len(code_failures) >= MAX_CODE_FAILURES:
            reason = f"code crashed or timed out {MAX_CODE_FAILURES} times"
        elif not ran and len(history) >= 2 and not history[-2]["ran"] and crash_key(history[-2]["message"]) == crash_key(message):
            reason = "same crash twice"
        elif real:
            reason = stop_reason(real, tokens, started) if ran else None
        if not reason and tokens >= MAX_TOKENS:
            reason = f"used {tokens} tokens, limit {MAX_TOKENS}"
        if not reason and time.time() - started >= MAX_SECONDS:
            reason = f"ran past {MAX_SECONDS} seconds"
        if reason:
            return summary(folder, history, tokens, started, f"stopped: {reason}", best.get("try") if best else None)
        if ran:
            base_code = best["code"] if best else code
            base_report = best["report"] if best else report
            text = retry_text(brief, base_code, failure_text(True, "", base_report))
            if best and best["code"] is not code:
                text += "\n\nThat is your best script so far. Your newest try had more problems, so it was set aside. Do not lose what this one gets right."
        else:
            advice = "It ran too long. Build fewer details, make cuts on simple solids before fillets, avoid repeated booleans on filleted shapes, and keep the script fast." if "second limit" in message else "Fix this error. Use only build123d calls you are sure of."
            if best:
                text = retry_text(brief, best["code"], failure_text(True, "", best["report"])) + f"\n\nYour newest try did not finish, so it was set aside: {message[-1500:]}\n{advice} Make smaller changes to the script above."
            else:
                text = retry_text(brief, code, f"{message}\n{advice}")


def summary(folder, history, tokens, started, outcome, best_try=None):
    result = {"outcome": outcome, "tries": len(history), "best_try": best_try or len(history), "tokens": tokens, "seconds": round(time.time() - started, 1), "model": MODEL,
              "history": [{k: h[k] for k in ("try", "ran", "message", "usage", "seconds")} | {"failed": [r["check"] for r in h["report"]["failed"]]} for h in history]}
    (Path(folder) / "summary.json").write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
    print(outcome, f"tries={len(history)} tokens={tokens} seconds={result['seconds']}", flush=True)
    return result


def design_case(parts, look, name, earlier_run=None, picture=None):
    """Carrier first, then the whole case, each with its own tries and all within the overall limit. earlier_run reuses a passed Carrier and continues from that run's last checked case try."""
    folder = HERE / "runs" / "agent" / name
    source = HERE / "runs" / "agent" / (earlier_run or name)
    continue_from = None
    base = None
    if parts.endswith(".json"):
        from concepts import base_picture
        base = json.loads(Path(parts).read_text(encoding="utf-8"))
        parts, look = base["parts"], base["look"]
        picture = base_picture(base)
        print(f"base design: {base['name']}, picture: {picture}", flush=True)
    part_ids = parts.split(",")
    part_id = part_ids[0]
    if picture == "auto":
        from concepts import concept
        picture = concept(part_id, look)
        print(f"concept picture: {picture}", flush=True)
    if earlier_run:
        shutil.copytree(source / "carrier", folder / "carrier", dirs_exist_ok=True)
        carrier = json.loads((source / "carrier" / "summary.json").read_text(encoding="utf-8"))
        checked = [t for t in sorted((source / "case").glob("try-*")) if (t / "design.py").exists() and (t / "report.json").exists()]
        continue_from = checked[-1] if checked else None
    else:
        carrier = design_part(carrier_brief(part_id), folder / "carrier")
    if carrier["outcome"] not in PASSING_OUTCOMES:
        return carrier
    code = (source / "carrier" / f"try-{carrier['tries']}" / "design.py").read_text(encoding="utf-8")
    brief = case_brief(part_ids, look, code)
    if picture:
        brief = "\n\n".join([brief, PICTURE_BRIEF])
    if base:
        brief = "\n\n".join([brief, base_brief(base)])
    body_stl = None
    if base and base.get("body_first"):
        from body_stage import design_body, frozen_body_brief
        body_code, body_stl, body_summary = design_body(base, picture, folder / "body")
        print("body", json.dumps({k: body_summary[k] for k in ("best_score", "tokens", "seconds")}), flush=True)
        if body_code is None:
            return {"outcome": "stopped: no valid body", **body_summary}
        brief = "\n\n".join([brief, frozen_body_brief(body_code)])
    return design_part(brief, folder / "case", min(MAX_CASE_TRIES, MAX_TOTAL_TRIES - carrier["tries"]), stage="case", continue_from=continue_from, picture=picture, base=base, body_stl=body_stl)


if __name__ == "__main__":
    arguments = sys.argv[1:6]
    design_case(*[a if a != "-" else None for a in arguments])
