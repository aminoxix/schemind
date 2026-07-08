"""schemind-py demo — watch the Python example backend drift in real time.

Learns a baseline shape from GET /api/books, then flips the backend through
every drift mode and prints what schemind detects. Run the backend first
(`python3 main.py`), then:

    python3 watch.py
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

# Zero-install bootstrap: use the in-repo schemind-py sources directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packages" / "py" / "src"))

from schemind import diff_report, extract_shape, normalize_endpoint  # noqa: E402

BASE = "http://localhost:8082"

BADGE = {"info": "\033[36mINFO\033[0m", "warn": "\033[33mWARN\033[0m", "breaking": "\033[31mBREAKING\033[0m"}


def fetch(method: str, path: str) -> object:
    req = urllib.request.Request(f"{BASE}{path}", method=method)
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read())


def main() -> None:
    endpoint = normalize_endpoint("GET", f"{BASE}/api/books")

    fetch("POST", "/api/_drift?mode=none")
    baseline = extract_shape(fetch("GET", "/api/books"))
    print(f"learned baseline for {endpoint}\n")

    for mode in ("none", "info", "warn", "breaking"):
        fetch("POST", f"/api/_drift?mode={mode}")
        observed = extract_shape(fetch("GET", "/api/books"))
        report = diff_report(endpoint, baseline, observed)

        if not report.changes:
            print(f"mode={mode:<8} ✓ no drift")
            continue
        print(f"mode={mode:<8} {BADGE[report.severity]} — {len(report.changes)} change(s)")
        for change in report.changes:
            print(f"    {BADGE[change.severity]:<20} {change.path or '(root)'} · {change.type}")

    fetch("POST", "/api/_drift?mode=none")  # leave the backend clean


if __name__ == "__main__":
    main()
