"""The front details a finished character case owes, as a fixed checklist. A detail is finished only when its geometry
rule passes (where geometry can decide) and the look reviewer, asked about that one detail, says it is done.
Passing every fit check does not finish a case: a case with unfinished details is a draft.

Which details apply comes from the checks that ran (a screen design runs window_fit, a knob design runs knob_room), so
nothing here knows about any one design."""

# id -> (applies when this check ran, or None for always; the reviewer's question; the fix to send back)
DETAILS = {
    "screen_bezel": ("window_fit",
                     "The screen sits in an even, rounded bezel that opens out to the front surface (not a square hole).",
                     "Cut the screen opening with screen_bezel(screen, body) in place of window(screen)."),
    "knob_cap": ("knob_room",
                 "The knob wears a printed cap shaped for the character, sitting in a clean dish (no bare metal knob).",
                 "Fit a cap: cap = knob_cap(knob, profile=..., fit_radius=knob_dish(...)[3]), then finish(..., "
                 "extra_prints={'PRINT_Knob': cap}, fitted_on={'PRINT_Knob': knob})."),
    "clean_front": (None,
                    "No screw heads, bosses, seams, stops or patches show on the front or the top.",
                    "Move screws and stops to the back or underneath, and close any patch or seam on the front."),
    "even_softness": (None,
                      "Every outer edge of the case is rounded alike; no sharp edge next to soft ones.",
                      "Round the sharp outer edges (openings, the seam, added parts) to match the body."),
}


def applies(report):
    """The detail ids this case owes: the always-on ones, plus each whose part's check ran."""
    ran = {r["check"] for r in report.get("results", [])}
    return [d for d, (needs, _q, _f) in DETAILS.items() if needs is None or needs in ran]


def rule(detail, code, report, design):
    """(ok, reason) from the geometry and the script, or (None, None) when only the picture can tell."""
    results = report.get("results", [])
    if detail == "screen_bezel":
        ok = "screen_bezel(" in (code or "")
        return ok, None if ok else "the screen opening is not cut with screen_bezel()"
    if detail == "knob_cap":
        if not (design or {}).get("fitted_on"):
            return False, "no printed cap is fitted on the knob (finish(..., fitted_on=...))"
        turns = [r for r in results if r["check"] == "knob_turns"]
        if not turns or not all(r["ok"] for r in turns):
            return False, "the cap would rub the case when it turns (knob_turns)"
        return True, None
    return None, None


def questions(ids):
    return "\n".join(f'- "{d}": {DETAILS[d][1]}' for d in ids)


def verify(ids, code, report, design, marks):
    """Each detail's state: {"id": {"done": bool, "why": str}}. marks are the reviewer's {"id": "done" | "not done"}."""
    states = {}
    for d in ids:
        ok, reason = rule(d, code, report, design)
        seen = str((marks or {}).get(d, "")).lower().strip()
        if ok is False:
            states[d] = {"done": False, "why": reason}
        elif seen != "done":
            states[d] = {"done": False, "why": "the look reviewer did not see it done" if seen else "the look reviewer did not judge it"}
        else:
            states[d] = {"done": True, "why": None}
    return states


def unfinished(states):
    return [d for d, s in states.items() if not s["done"]]


def fixes(states):
    return [f"{d}: {s['why']}. {DETAILS[d][2]}" for d, s in states.items() if not s["done"]]
