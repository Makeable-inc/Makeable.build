"""Which parts a person must reach from outside the case. Plain rules, with no AI.

Needs an opening: what you look at or use (screen, knob, touch sensor, a part marked outside_view), and power, unless the project has a battery.
Stays inside, with room around it: everything else, such as boot and reset buttons and unused ports. A later version can ask the user about these.
"""
import numpy as np
import trimesh

from card import build_card
from checks import result, travel


def has_battery(part_ids):
    return any("batter" in p or "lipo" in p or "18650" in p or build_card(p).get("role") == "battery" for p in part_ids)


def access_list(part_ids):
    """Every item that must reach the outside, as (part name, feature, why)."""
    battery = has_battery(part_ids)
    items = []
    for index, part_id in enumerate(part_ids):
        name = "PURCHASE_Board" if index == 0 else f"PURCHASE_Part{index + 1}"
        features = build_card(part_id)["features"]
        if "screen" in features:
            items.append((name, "screen", "you look at it"))
        if "shaft" in features:
            items.append((name, "shaft", "you turn and press it"))
        if "touch" in features:
            items.append((name, "touch", "you touch it"))
        if "usb" in features and not battery:
            items.append((name, "usb", "it needs power, and the project has no battery"))
        items.extend((name, key, "it needs to see outside") for key, feature in features.items() if feature.get("outside_view"))
    return items


def access_lines(part_ids):
    return [f"- {name} {feature}: {why}" for name, feature, why in access_list(part_ids)]


def _centre(feature):
    return (np.array(feature["min"], dtype=float) + np.array(feature["max"], dtype=float)) / 2


def _axis(text):
    vector = np.zeros(3)
    vector["xyz".index(text[1])] = 1 if text[0] == "+" else -1
    return vector


def check_access(part_ids, meshes, cards, transforms, fitted=None):
    """Each item on the access list has a clear straight path from the part to outside the case. fitted: printed parts
    fitted onto a part from outside ({"PRINT_Knob": "PURCHASE_Part3"}): a knob cap is how you reach its shaft, so it is
    left out of that part's path (every other printed part still counts)."""
    if not meshes:
        return []
    fitted = fitted or {}
    results = []
    for name, key, why in access_list(part_ids):
        if name not in transforms or name not in cards:
            continue
        card, matrix = cards[name], transforms[name]
        others = [m for n, m in meshes.items() if fitted.get(n) != name]
        if not others:
            results.append(result("access", f"{name} {key}", True, measured="clear", limit="a clear straight path to outside the case", where=why))
            continue
        union = trimesh.util.concatenate(others)
        feature = card["features"][key]
        if key == "usb":
            sides = [feature["opens_toward"]]
        elif key == "shaft":
            sides = [feature["points"]]
        elif key == "touch":
            sides = feature.get("may_face_out") or [card["front"]]
        else:
            sides = [feature.get("outside_view")] if isinstance(feature.get("outside_view"), str) else [card["front"]]
        centre = _centre(feature)
        clear = False
        for side in sides:
            direction = _axis(side)
            axis = int(np.argmax(np.abs(direction)))
            start = centre.copy()
            start[axis] = feature["max" if direction[axis] > 0 else "min"][axis]
            world = (matrix[:3, :3] @ start) + matrix[:3, 3]
            outward = matrix[:3, :3] @ direction
            distance, _ = travel(union, world[None], outward)
            clear = clear or bool(np.isinf(distance))
        results.append(result("access", f"{name} {key}", clear, measured="clear" if clear else "blocked", limit="a clear straight path to outside the case", where=why,
                              fix=f"{name} {key} must be reachable from outside, because {why}. Make a fitted opening straight out from it through every printed part."))
    return results
