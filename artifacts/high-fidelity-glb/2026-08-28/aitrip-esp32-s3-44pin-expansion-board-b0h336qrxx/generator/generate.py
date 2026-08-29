#!/usr/bin/env python3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
subprocess.run([
    "python3",
    str(ROOT / "scripts/assembly3d/generate_esp32_expansion_glbs.py"),
    "aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx",
    str(Path(__file__).resolve().parents[1] / "models/aitrip-esp32-s3-44pin-expansion-board-b0h336qrxx.glb"),
], check=True)
