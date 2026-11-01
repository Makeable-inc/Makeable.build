"""Runs today's checks on saved designs, for free, so a checker change can be tested without any new AI calls."""
import sys
import time

import checks

for folder in sys.argv[1:]:
    started = time.time()
    report = checks.check_design(folder, "case")
    print(folder, "PASSED" if report["passed"] else "FAILED", f"{len(report['results']) - len(report['failed'])} of {len(report['results'])}", f"{time.time() - started:.0f}s", flush=True)
    for r in report["failed"]:
        print("  FAIL", r["check"], r["part"], r["measured"], str(r["where"])[:120], flush=True)
    for r in report["warnings"]:
        print("  warn", r["check"], r["part"], r["measured"], flush=True)
