#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/claude-burner-firmware-tests.XXXXXX")
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

"${CXX:-c++}" -std=c++17 \
  "$project_dir/test/native/test_deferred_commit.cpp" \
  -I "$project_dir/include" \
  -o "$temporary_dir/test-deferred-commit"

"$temporary_dir/test-deferred-commit"

"${CXX:-c++}" -std=c++17 \
  "$project_dir/test/native/test_link_recovery.cpp" \
  -I "$project_dir/include" \
  -o "$temporary_dir/test-link-recovery"

"$temporary_dir/test-link-recovery"
