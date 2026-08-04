#!/bin/bash
set -euo pipefail

firmware_dir="$(cd "$(dirname "$0")/.." && pwd)"
venv_dir="$firmware_dir/.venv"
if [ -x /opt/anaconda3/bin/python3 ]; then
  python_bin=/opt/anaconda3/bin/python3
else
  python_bin="$(command -v python3.13 || command -v python3)"
fi
venv_compatible=false
if [ -x "$venv_dir/bin/python" ]; then
  if "$venv_dir/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)'; then
    venv_compatible=true
  fi
fi
if [ ! -x "$venv_dir/bin/pio" ] || [ "$venv_compatible" != true ]; then
  "$python_bin" -m venv --clear "$venv_dir"
  "$venv_dir/bin/python" -m pip install --upgrade pip platformio intelhex
fi
"$venv_dir/bin/pio" --version
