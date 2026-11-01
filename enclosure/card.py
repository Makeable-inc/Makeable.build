"""Part cards. A card names which parts of the AWS model are the screen, USB and so on; every size is measured from the model, never typed in."""
import hashlib
import json
from pathlib import Path

import numpy as np
import trimesh

from part_variants import base_hash_path
from parts import ensure_part

CARDS = Path(__file__).resolve().parent / "cards"
DIRECTIONS = {"+x": (0, 1), "-x": (0, 0), "+y": (1, 1), "-y": (1, 0), "+z": (2, 1), "-z": (2, 0)}


class CardError(ValueError):
    pass


def load_nodes(glb_path):
    """Maps each mesh node to its mesh in millimetres. Manufacturer solids are keyed by their short number."""
    scene = trimesh.load(glb_path, force="scene")
    if scene.units not in (None, "m", "meter", "meters"):
        raise CardError(f"model units are {scene.units}, expected metres")
    nodes = {}
    for name in scene.graph.nodes_geometry:
        transform, geometry = scene.graph[name]
        mesh = scene.geometry[geometry].copy()
        mesh.apply_transform(transform)
        mesh.apply_scale(1000)
        key = name.rsplit(":", 1)[-1] if name.startswith("mesh:") else name
        nodes[key] = mesh
    return nodes


def box(meshes):
    bounds = np.array([m.bounds for m in meshes])
    return bounds[:, 0].min(axis=0), bounds[:, 1].max(axis=0)


def measure(spec, nodes):
    """Turns a card's node lists into measured boxes, and refuses anything the model cannot back up."""
    all_low, all_high = box(list(nodes.values()))
    envelope = {"min": all_low.round(3).tolist(), "max": all_high.round(3).tolist(), "size": (all_high - all_low).round(3).tolist()}
    features = {}
    for name, feature in spec["features"].items():
        if "box" in feature:
            # Only for what the model cannot show, such as a screen it does not mark. The feature must say it is an estimate.
            if "estimate" not in feature:
                raise CardError(f"{name}: a typed-in box must say why it is an estimate")
            low, high = np.array(feature["box"]["min"]), np.array(feature["box"]["max"])
        else:
            names = feature["nodes"]
            missing = [n for n in names if n not in nodes]
            if missing:
                raise CardError(f"{name}: model has no node {missing}")
            low, high = box([nodes[n] for n in names])
        features[name] = {"min": low.round(3).tolist(), "max": high.round(3).tolist(), "size": (high - low).round(3).tolist()}
        features[name].update(feature)
    for required in ("glass", "screen"):
        if required not in features:
            continue
        axis, side = DIRECTIONS[spec["front"]]
        face = features[required]["max" if side else "min"][axis]
        if abs(face - envelope["max" if side else "min"][axis]) > 0.05:
            raise CardError(f"{required}: front face at {face} is not the front of the part")
    if "usb" in features:
        usb = features["usb"]
        if usb["opens_toward"] not in DIRECTIONS:
            raise CardError(f"usb: unknown direction {usb['opens_toward']}")
        axis, side = DIRECTIONS[usb["opens_toward"]]
        bound = "max" if side else "min"
        usb["mouth"] = usb[bound][axis]
        if abs(usb["mouth"] - envelope[bound][axis]) > 0.5:
            raise CardError(f"usb: mouth at {usb['mouth']} is not at the part's {usb['opens_toward']} edge {envelope[bound][axis]}")
    if "screen" in features and "glass" in features:
        s, g = features["screen"], features["glass"]
        if any(s["min"][i] < g["min"][i] or s["max"][i] > g["max"][i] for i in (0, 1)):
            raise CardError("screen: active area is larger than the glass")
    return envelope, features


def build_card(part_id):
    spec = json.loads((CARDS / f"{part_id}.json").read_text(encoding="utf-8"))
    path = ensure_part(part_id)
    actual = hashlib.sha256(base_hash_path(part_id).read_bytes()).hexdigest()
    if actual != spec["sha256"]:
        raise CardError(f"card was reviewed for model {spec['sha256'][:8]}, catalog now has {actual[:8]}; review it again")
    nodes = load_nodes(path)
    envelope, features = measure(spec, nodes)
    buttons = []
    for button in spec.get("buttons", []):
        missing = [n for n in button["nodes"] if n not in nodes]
        if missing or button["press_from"] not in DIRECTIONS:
            raise CardError(f"button: bad nodes {missing} or direction {button['press_from']}")
        low, high = box([nodes[n] for n in button["nodes"]])
        buttons.append({"min": low.round(3).tolist(), "max": high.round(3).tolist(), "press_from": button["press_from"]})
    return {"part_id": part_id, "sha256": actual, "role": spec.get("role"), "pins_point": spec.get("pins_point"), "front": spec["front"], "envelope": envelope, "features": features, "buttons": buttons}


if __name__ == "__main__":
    import sys
    print(json.dumps(build_card(sys.argv[1]), indent=1))
