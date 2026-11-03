"""TEST VARIANTS of catalog parts, to compare a design choice. Not catalog parts: the AWS model stays the truth, and the team's decision for the KY-040 is still pins up.

The sideways KY-040 keeps every piece of the AWS model and replaces only the five upright metal pins with bent ones. The pin holes come from the model. The bend height is an assumption until a right-angle module is measured."""
import hashlib
from pathlib import Path

import trimesh

HERE = Path(__file__).resolve().parent
FOLDER = HERE / ".cache" / "parts"
KY040_SIDEWAYS = "ky-040-rotary-encoder-sideways-test"
# Assumed: the pin bends at the middle of the plastic header, and its reach past the bend equals the upright pin's reach above the PCB.
BEND_HEIGHT = 1.95
VARIANTS = {KY040_SIDEWAYS: "ky-040-rotary-encoder"}


def base_of(part_id):
    return VARIANTS.get(part_id, part_id)


def is_upright_pin(name):
    return name.startswith("ky040-j1:pin:") and name.endswith(":metal")


def bent_pin(mesh):
    """In metres, like the model: a stub through the PCB up to the bend, then straight out along +x."""
    low, high = mesh.bounds
    x, y = (low[:2] + high[:2]) / 2
    width = high[0] - low[0]
    bend = BEND_HEIGHT / 1000
    reach = high[2] - 0.8 / 1000
    stub = trimesh.creation.box(extents=(width, width, bend - low[2] + width / 2), transform=trimesh.transformations.translation_matrix((x, y, (low[2] + bend + width / 2) / 2)))
    arm = trimesh.creation.box(extents=(reach, width, width), transform=trimesh.transformations.translation_matrix((x + reach / 2, y, bend)))
    return trimesh.boolean.union([stub, arm], engine="manifold")


def build_variant(part_id, base_path):
    """Returns the variant's model file. It is rebuilt only when the hash-checked base model changes."""
    digest = hashlib.sha256(base_path.read_bytes()).hexdigest()[:12]
    path = FOLDER / f"{part_id}-{digest}.glb"
    if path.exists():
        return path
    source = trimesh.load(base_path, force="scene")
    scene = trimesh.Scene()
    for name in source.graph.nodes_geometry:
        transform, geometry = source.graph[name]
        mesh = source.geometry[geometry].copy()
        mesh.apply_transform(transform)
        if is_upright_pin(name):
            mesh = bent_pin(mesh)
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    path.write_bytes(scene.export(file_type="glb"))
    return path


def base_hash_path(part_id):
    """The catalog model behind a part, which is what a card is reviewed against."""
    from parts import ensure_part
    return ensure_part(base_of(part_id))

