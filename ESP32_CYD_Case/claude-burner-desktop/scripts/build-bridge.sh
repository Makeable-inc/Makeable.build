#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$project_dir/build/bin"
mkdir -p "$output_dir"

xcrun swiftc \
  -O \
  -target arm64-apple-macos13.0 \
  "$project_dir/bridge/ClaudeBurnerStatusline.swift" \
  -o "$output_dir/claude-burner-statusline-bridge"

codesign --force --sign - "$output_dir/claude-burner-statusline-bridge"
echo "Built $output_dir/claude-burner-statusline-bridge"
