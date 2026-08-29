#!/usr/bin/env python3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
subprocess.run([
    "python3",
    str(ROOT / "scripts/assembly3d/generate_esp32_expansion_glbs.py"),
    "seeed-xiao-expansion-base-103030356",
    str(Path(__file__).resolve().parents[1] / "models/seeed-xiao-expansion-base-103030356.glb"),
], check=True)
