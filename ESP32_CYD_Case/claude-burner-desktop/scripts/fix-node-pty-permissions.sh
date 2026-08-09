#!/bin/bash
set -euo pipefail

for helper in node_modules/node-pty/prebuilds/darwin-*/spawn-helper; do
  if [[ -f "$helper" ]]; then
    chmod 755 "$helper"
  fi
done
