#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
source_image="$project_dir/assets/scenes/lv3_supercharged.png"
iconset="$project_dir/build/ClaudeBurner.iconset"
square_source="$project_dir/build/icon-square.png"

mkdir -p "$project_dir/build"
rm -rf "$iconset"
mkdir -p "$iconset"
sips --padToHeightWidth 320 320 --padColor 080b12 "$source_image" --out "$square_source" >/dev/null

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$square_source" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$square_source" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$iconset" -o "$project_dir/build/icon.icns"
echo "Built $project_dir/build/icon.icns"
