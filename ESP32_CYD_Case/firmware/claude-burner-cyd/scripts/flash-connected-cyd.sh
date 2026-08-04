#!/bin/bash
set -euo pipefail

firmware_dir="$(cd "$(dirname "$0")/.." && pwd)"
pio="$firmware_dir/.venv/bin/pio"
if [ ! -x "$pio" ]; then
  "$firmware_dir/scripts/install-platformio.sh"
fi

ports=()
for candidate in /dev/cu.usbserial* /dev/cu.wchusbserial* /dev/cu.SLAB_USBtoUART*; do
  if [ -e "$candidate" ]; then ports+=("$candidate"); fi
done
if [ "${#ports[@]}" -ne 1 ]; then
  echo "Expected exactly one USB serial display, found ${#ports[@]}: ${ports[*]:-none}" >&2
  exit 2
fi

cd "$firmware_dir"
"$pio" run
"$pio" run --target upload --upload-port "${ports[0]}"
echo "Flashed Claude Burner to ${ports[0]}"
