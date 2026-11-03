"""Runs each printed part through OrcaSlicer's command line in its best flat orientation, and reads back layers, supports, time and filament. The printer is an assumed common one until a real printer is chosen."""
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np
import trimesh

from checks import load_stl

HERE = Path(__file__).resolve().parent
ORCA = HERE / ".cache" / "tools" / "orca"
PROFILES = ORCA / "resources" / "profiles" / "BBL"
MACHINE = "Bambu Lab A1 0.4 nozzle"
PROCESS = "0.20mm Standard @BBL A1"
FILAMENT = "Generic PLA @BBL A1"
UPS = {"+x": (1, 0, 0), "-x": (-1, 0, 0), "+y": (0, 1, 0), "-y": (0, -1, 0), "+z": (0, 0, 1), "-z": (0, 0, -1)}
TIME_LIMIT_SECONDS = 300


def flattened(kind, name):
    """Orca's profiles inherit from parents, and the command line needs the whole profile in one file."""
    data = json.loads((PROFILES / kind / f"{name}.json").read_text(encoding="utf-8"))
    parent = data.pop("inherits", None)
    merged = flattened(kind, parent) if parent else {}
    merged.update(data)
    return merged


def write_profiles(folder):
    paths = {}
    for kind, name in (("machine", MACHINE), ("process", PROCESS), ("filament", FILAMENT)):
        profile = flattened(kind, name)
        profile["from"] = "system"
        profile["name"] = name
        profile["inherits"] = ""
        if kind == "machine":
            profile["printer_settings_id"] = name
        if kind == "process":
            profile["print_settings_id"] = name
        if kind == "filament":
            profile["filament_settings_id"] = [name]
        if kind != "machine":
            # An empty list means compatible with any printer; the names in the shipped lists cover the parents, not this flattened copy.
            profile["compatible_printers"] = [MACHINE]
        if kind == "process":
            profile["enable_support"] = "1"
            profile["support_type"] = "tree(auto)"
        path = folder / f"{kind}.json"
        path.write_text(json.dumps(profile), encoding="utf-8")
        paths[kind] = path
    return paths


def best_orientation(mesh):
    """The flat orientation with the least surface needing support, preferring more contact with the bed."""
    best = None
    for name, up in UPS.items():
        up = np.array(up, dtype=float)
        facing = mesh.face_normals @ up
        heights = mesh.triangles_center @ up
        on_bed = (heights - (mesh.vertices @ up).min() < 0.2) & (facing < -0.99)
        overhang = (facing < -np.cos(np.radians(45))) & ~on_bed
        score = (float(mesh.area_faces[overhang].sum()) - float(mesh.area_faces[on_bed].sum()), name)
        if best is None or score < best:
            best = score
    up = np.array(UPS[best[1]], dtype=float)
    return best[1], trimesh.geometry.align_vectors(up, [0, 0, 1])


def read_result(path):
    with zipfile.ZipFile(path) as archive:
        info = archive.read("Metadata/slice_info.config").decode("utf-8", "replace")
        gcode_name = next(n for n in archive.namelist() if n.endswith(".gcode"))
        gcode = archive.read(gcode_name).decode("utf-8", "replace")
    found = {}
    for key in ("prediction", "weight", "support_used"):
        match = re.search(rf'key="{key}" value="([^"]*)"', info)
        found[key] = match.group(1) if match else None
    layers = re.search(r"total layer number:\s*(\d+)", gcode)
    found["layers"] = int(layers.group(1)) if layers else None
    found["support_lines"] = gcode.count("; FEATURE: Support") + gcode.count(";TYPE:Support")
    return found


def slice_design(folder):
    folder = Path(folder)
    out = folder / "sliced"
    out.mkdir(exist_ok=True)
    profiles = write_profiles(out)
    report = {}
    for stl in sorted(folder.glob("PRINT_*.stl")):
        mesh = load_stl(stl)
        name, turn = best_orientation(mesh)
        mesh.apply_transform(turn)
        mesh.apply_translation([128 - mesh.bounds[:, 0].mean(), 128 - mesh.bounds[:, 1].mean(), -mesh.bounds[0][2]])
        placed = out / stl.name
        mesh.export(placed)
        result = out / f"{stl.stem}.3mf"
        result.unlink(missing_ok=True)
        command = [str(ORCA / "orca-slicer.exe"), "--slice", "1", "--load-settings", f"{profiles['machine'].resolve()};{profiles['process'].resolve()}", "--load-filaments", str(profiles["filament"].resolve()), "--export-3mf", result.name, "--outputdir", str(out.resolve()), str(placed.resolve())]
        try:
            done = subprocess.run(command, capture_output=True, text=True, errors="replace", timeout=TIME_LIMIT_SECONDS, cwd=ORCA)
            (out / f"{stl.stem}.log").write_text(done.stdout + done.stderr, encoding="utf-8")
            entry = {"up": name, "exit": done.returncode, "size_mm": np.round(mesh.bounds[1] - mesh.bounds[0], 1).tolist()}
            if result.exists():
                entry.update(read_result(result))
            else:
                entry["error"] = (done.stdout + done.stderr)[-500:]
        except subprocess.TimeoutExpired:
            entry = {"up": name, "error": f"slicer ran past {TIME_LIMIT_SECONDS} s"}
        report[stl.stem] = entry
        print(stl.stem, json.dumps(entry)[:500], flush=True)
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return report


if __name__ == "__main__":
    slice_design(sys.argv[1])
