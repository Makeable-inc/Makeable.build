"""The real hardware and limits, told to the look reviewer, so its advice fits the design: it names the parts by kind
(a touch button is not a knob), the face and depth limits and the spare room, and its fixes that break them are dropped
before they reach the agent."""
import re

from body_stage import screen_limits

ROOMY = 3.0   # mm: less spare room than this on an axis, and a fix asking to grow that way is dropped


def kinds(base):
    """The visible parts by kind, and whether the design has a knob."""
    ids = [p.lower() for p in base.get("parts", "").split(",") if p]
    out, knob = [], False
    for part in ids:
        if "encoder" in part or "knob" in part:
            out.append("a rotary knob (it turns and clicks)")
            knob = True
        elif "touch" in part and not any(w in part for w in ("display", "lcd", "ips")):
            out.append("a touch button: flat, behind a round opening in the wall (there is no knob)")
        elif any(w in part for w in ("oled", "tft", "lcd", "amoled", "display")):
            try:
                limit = screen_limits(base)
                out.append(f"a screen {limit['screen_width']:.0f} x {limit['screen_height']:.0f} mm (its size cannot change)")
            except Exception:
                out.append("a screen (its size cannot change)")
        else:
            out.append("a controller board inside (not seen)")
    return out, knob


def body_size(mesh):
    """(face width, depth, face height): the face as the size rules measure it (ornaments not counted)."""
    from body_rules import face_size
    width, height = face_size(mesh)
    return width, float(mesh.bounds[1][1] - mesh.bounds[0][1]), height


def spare(base, size):
    """Spare room (mm) per axis: how much more the body may grow before a limit stops it, and how much it has over
    the parts' room. size is (face width, depth, face height), from body_size()."""
    limit = screen_limits(base)
    room = base.get("min_body") or {}
    width, depth, height = size
    grow_w = (limit["tight_width"] if height > limit["tight_height"] else limit["max_width"]) - width
    grow_h = (limit["tight_height"] if width > limit["tight_width"] else limit["max_height"]) - height
    return {"grow_width": round(grow_w, 1), "grow_height": round(grow_h, 1), "grow_depth": round(base["max_depth"] - depth, 1),
            "over_room": {k: round(v - room[k], 1) for k, v in (("width", width), ("depth", depth), ("height", height)) if k in room}}


def facts(base, size=None):
    """The fact sheet for the reviewer."""
    parts, _ = kinds(base)
    try:
        limit = screen_limits(base)
    except Exception:
        limit = None
    lines = ["The real hardware and limits. Every fix must fit these; if the look needs more than they allow, name the",
             "limit that blocks it instead of asking for it.",
             "- Parts seen from outside: " + ("; ".join(p for p in parts if "inside" not in p) or "as in the picture") + "."]
    if limit:
        lines.append(f"- The face (the main front, ornaments not counted) must be at most {limit['max_width']:.0f} mm wide and "
                     f"{limit['max_height']:.0f} mm tall.")
    if base.get("max_depth"):
        lines.append(f"- Depth at most {base['max_depth']} mm. The back is a flat printed cover.")
    if size is not None and limit and base.get("max_depth"):
        room = spare(base, size)
        grow = {k: max(0.0, v) for k, v in room.items() if k.startswith("grow_")}
        lines.append(f"- Right now the face can grow at most {grow['grow_width']} mm wider and {grow['grow_height']} mm taller, "
                     f"and the body {grow['grow_depth']} mm deeper; it is {room['over_room']} mm over the parts' room.")
    return "\n".join(lines)


def parts_phrase(base):
    """The parts in place, in words, for the case review: 'the screen, the touch button and the board'."""
    parts, knob = kinds(base)
    names = []
    for p in parts:
        names.append("the knob" if p.startswith("a rotary") else "the touch button" if p.startswith("a touch") else
                     "the screen" if p.startswith("a screen") else "the board")
    order = {"the screen": 0, "the knob": 1, "the touch button": 1, "the board": 2}
    names = sorted(dict.fromkeys(names), key=lambda n: order.get(n, 3))
    return ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else (names[0] if names else "the parts")


GROW = {"grow_height": r"\btaller\b|\b(increase|raise|add)\b[^.;]{0,40}\bheight\b|\bheight\b[^.;]{0,20}\bby \d",
        "grow_width": r"\bwider\b|\b(increase|add)\b[^.;]{0,40}\bwidth\b|\bwidth\b[^.;]{0,20}\bby \d",
        "grow_depth": r"\bdeeper\b|\b(increase|add)\b[^.;]{0,40}\bdepth\b"}


def filter_fixes(fixes, base, size=None):
    """(kept, dropped): fixes naming a part the design does not have, or asking to grow where the limits leave no room."""
    _, knob = kinds(base)
    try:
        room = spare(base, size) if size is not None else None
    except Exception:
        room = None
    kept, dropped = [], []
    for fix in fixes:
        text = str(fix).lower()
        if not knob and re.search(r"\bknob\b|\bdial\b", text):
            dropped.append((fix, "this design has no knob"))
            continue
        # Growing a feature (spikes, ears, a tail) is fine: ornaments do not count in the face. Only the main form is limited.
        about_form = re.search(r"\b(body|main form|case|front|face|roof|top surface|overall|silhouette)\b", text)
        about_feature = re.search(r"\b(spike|ear|tail|fin|eye|arm|leg|antenna|paw|horn|nose|cone|foot|feet)s?\b", text)
        limited = about_form and not (about_feature and not re.search(r"\b(body|main form)\b", text))
        blocked = next((axis for axis, pattern in GROW.items() if limited and room and room[axis] < ROOMY and re.search(pattern, text)), None)
        if blocked:
            dropped.append((fix, f"no room: the limits allow only {room[blocked]} mm more ({blocked.replace('grow_', '')})"))
            continue
        kept.append(fix)
    return kept, dropped


TIGHT = 6.0   # mm: less spare than this on an axis and a rounded form cannot round much there


def space_report(base):
    """Before any drawing: how much room the main form has beyond the parts' room on each axis, in mm, from the face
    limits and the depth limit. A report explains the room; it does not make any. None if the limits are unknown."""
    room = base.get("min_body") or {}
    try:
        limit = screen_limits(base)
    except Exception:
        return None
    if not room or not base.get("max_depth"):
        return None
    w, d, h = room["width"], room["depth"], room["height"]
    deep = base["max_depth"] - d
    # The face may be wide and low (up to max_width wide, at most tight_height tall) or narrow and tall (at most
    # tight_width wide, up to max_height tall). Only shapes the parts' room fits into are real options.
    options = []
    if (limit["tight_width"], limit["tight_height"]) == (limit["max_width"], limit["max_height"]):
        if w <= limit["max_width"] and h <= limit["max_height"]:
            options.append(("any proportions", limit["max_width"] - w, limit["max_height"] - h))
    else:
        if h <= limit["tight_height"] and w <= limit["max_width"]:
            options.append(("wide and low", limit["max_width"] - w, limit["tight_height"] - h))
        if w <= limit["tight_width"] and h <= limit["max_height"]:
            options.append(("narrow and tall", limit["tight_width"] - w, limit["max_height"] - h))
    lines = [f"Space for the main form beyond the parts' room ({w:.0f} wide, {d:.0f} deep, {h:.0f} tall mm, walls included):"]
    if not options:
        lines.append("- none: the parts' room is already bigger than the face limits allow.")
    for name, more_w, more_h in options:
        lines.append(f"- {name} face: up to {more_w:.1f} mm more width and {more_h:.1f} mm more height")
    lines += [f"- depth: up to {deep:.1f} mm more (limit {base['max_depth']} mm; the back is cut flat)",
              "- Features (ears, horns, tails, fins, feet) do not count in the face, so they may reach past these."]
    best_w = max((o[1] for o in options), default=0.0)
    best_h = max((o[2] for o in options), default=0.0)
    tight = [name for name, value in (("height", best_h), ("width", best_w), ("depth", deep)) if value < TIGHT]
    if tight:
        lines.append(f"- Tight: under {TIGHT:.0f} mm spare in {' and '.join(tight)}. The main form can barely round there "
                     "without cutting into the parts' room: round only within the spare, and carry the character with "
                     "features and the outline seen from the front instead.")
    return "\n".join(lines)
