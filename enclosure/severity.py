"""Sorts closed-case check results into must-pass and warning. Must-pass is what the product needs to work and be printed; a warning goes on the checklist for the first test print."""
import math
import re

# My additions for looks and comfort: reported, never failing.
WARNING_ONLY = {"viewing_angle", "screen_faces_viewer", "window_fit", "window_view", "screen_share", "opening_fit", "case_closed",
                "wire_bend", "wire_clear_plastic", "wire_clear_parts", "wire_clear_usb", "wire_crossing", "wire_inside", "wire_hidden", "wire_room", "wire_bay", "wire_length",
                "base_proportion", "base_depth", "base_place", "base_facing", "base_usb", "body_no_growth", "body_kept",
                "button_reach", "knob_room", "knob_place", "press_stop", "press_not_on_wire"}
MAX_THIN_AREA = 0.05
MIN_PRINTABLE_WALL = 1.0
MAX_SANDING_DEPTH = 0.5
MAX_LOOSE = 2.0
MIN_SEAT = 0.5
MIN_GRIP = 0.6
MAX_SHANK_OVERLAP = 1.0


def is_warning(r):
    """True if a failed result can go on the print checklist. Anything not named here stays a must-pass."""
    check, measured = r["check"], r.get("measured")
    if check in WARNING_ONLY:
        return True
    if check == "wall":
        return r.get("thin_below_minimum", 1.0) <= MAX_THIN_AREA
    if check in ("assembly", "insertable"):
        return r.get("sanding_depth", math.inf) <= MAX_SANDING_DEPTH
    if r.get("can_be_glued"):
        return True
    if check in ("held", "retained"):
        return isinstance(measured, (int, float)) and measured <= MAX_LOOSE
    if check == "screw_seat":
        return isinstance(measured, (int, float)) and measured >= MIN_SEAT
    if check == "screw_grip":
        match = re.match(r"([\d.]+) solid around, ([\d.]+) mm3", str(measured))
        return bool(match) and float(match.group(1)) >= MIN_GRIP and float(match.group(2)) < 0.5
    if check == "screw_fit":
        return isinstance(measured, (int, float)) and measured <= MAX_SHANK_OVERLAP
    return False
