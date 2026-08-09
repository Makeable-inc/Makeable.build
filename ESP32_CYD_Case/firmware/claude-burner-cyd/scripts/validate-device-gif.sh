#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: $0 GIF [GIF ...]" >&2
  exit 64
fi

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
animated_gif_dir="$project_dir/.pio/libdeps/cyd-esp32/AnimatedGIF/src"
validator_source="$project_dir/test/native/validate_device_gif.cpp"

if [ ! -f "$animated_gif_dir/AnimatedGIF.cpp" ]; then
  echo "AnimatedGIF dependency is missing; run 'pio run' first." >&2
  exit 69
fi

temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/claude-burner-gif-validator.XXXXXX")
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

"${CXX:-c++}" -std=c++17 \
  "$validator_source" \
  "$animated_gif_dir/AnimatedGIF.cpp" \
  -I "$animated_gif_dir" \
  -o "$temporary_dir/validate-device-gif"

"$temporary_dir/validate-device-gif" "$@"
