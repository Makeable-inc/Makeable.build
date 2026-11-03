"""Downloads part models from the active catalog release, checking their hashes, and keeps them locally."""
import hashlib
import json
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE.parent / "artifacts/aws-assembly-release/prompt2circuit-production-ready79-speech-capture-20260904-v1/manifest.json"
FOLDER = HERE / ".cache" / "parts"


def catalog_entry(part_id):
    assets = json.loads(MANIFEST.read_text(encoding="utf-8"))["assets"]
    for a in assets:
        if a["partId"] == part_id:
            return a
    raise KeyError(f"{part_id} is not in the catalog release")


def ensure_part(part_id):
    """Returns the path of the part's GLB, always hash-checked against the catalog."""
    from part_variants import VARIANTS, build_variant
    if part_id in VARIANTS:
        return build_variant(part_id, ensure_part(VARIANTS[part_id]))
    entry = catalog_entry(part_id)
    path = FOLDER / f"{part_id}.glb"
    if path.exists():
        data = path.read_bytes()
    else:
        data = urllib.request.urlopen(entry["url"], timeout=120).read()
    if hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise RuntimeError(f"hash mismatch for {part_id}")
    if not path.exists():
        FOLDER.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path
