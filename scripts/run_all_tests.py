#!/usr/bin/env python3
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def main() -> int:
    run(["npm", "test"])
    run([sys.executable, "-m", "pytest", "-q", "analysis/tests", "benchmark/tests", "tests/test_real_camera_metrics.py"])
    print("All Stitch 360 release tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
