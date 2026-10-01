#!/usr/bin/env python3
"""Stitch 360 Sprint 5 external-baseline benchmark runner.

Consumes an extracted bundle produced by docs/baseline-export.html. The bundle
contains the exact ground-truth panorama, synthetic dual-fisheye input, and
Stitch 360 reconstruction. The runner evaluates that reconstruction and, when
installed, runs FFmpeg v360 and a fixed-geometry Hugin pipeline on the exact
same dual-fisheye input.

The script records commands, tool versions, wall-clock runtimes, failures, and
full/seam metrics. Missing external tools are reported as skipped rather than
silently substituted.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

METHOD_STITCH360 = "stitch360"
METHOD_FFMPEG = "ffmpeg_v360"
METHOD_HUGIN = "hugin_known_geometry"

METRIC_COLUMNS = [
    "mse", "mae", "psnr", "ssim",
    "seamMse", "seamMae", "seamPsnr", "seamSsim", "seamGradientError", "seamPixels",
]


def read_manifest(bundle: Path) -> list[dict[str, str]]:
    manifest_path = bundle / "manifest.csv"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing manifest.csv in {bundle}")
    with manifest_path.open(newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        raise ValueError("manifest.csv contains no rows")
    required = {"id", "image", "width", "height", "fovDeg", "rightLensGain", "generatorFovDelta",
                "seamHalfWidthDeg", "groundTruth", "dualFisheye", "stitch360"}
    missing = required.difference(rows[0])
    if missing:
        raise ValueError(f"manifest.csv missing columns: {sorted(missing)}")
    return rows


def classify_condition(gain: float, fov_delta: float) -> str:
    gain_clean = math.isclose(gain, 1.0, abs_tol=1e-9)
    fov_clean = math.isclose(fov_delta, 0.0, abs_tol=1e-9)
    if gain_clean and fov_clean:
        return "C0 Clean"
    if not gain_clean and fov_clean:
        return "C1 Photometric"
    if gain_clean and not fov_clean:
        return "C2 Calibration"
    return "C3 Combined"


def load_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"), dtype=np.float64)


def rgb_luma(arr: np.ndarray) -> np.ndarray:
    return 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]


def _integral(a: np.ndarray) -> np.ndarray:
    # Integral image with one zero-padded row/column, matching the JS implementation.
    return np.pad(np.cumsum(np.cumsum(a, axis=0), axis=1), ((1, 0), (1, 0)), mode="constant")


def _rect_sum(integral: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> float:
    return float(integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0])


def luma_ssim(reference: np.ndarray, candidate: np.ndarray, *, window_size: int = 7,
              region_x_mask: np.ndarray | None = None) -> float:
    if reference.shape != candidate.shape or reference.ndim != 3 or reference.shape[2] != 3:
        raise ValueError("SSIM inputs must be equal H×W×3 arrays")
    if window_size < 3 or window_size % 2 == 0:
        raise ValueError("window_size must be odd and >= 3")
    h, w, _ = reference.shape
    if h < window_size or w < window_size:
        raise ValueError("image smaller than SSIM window")
    x = rgb_luma(reference)
    y = rgb_luma(candidate)
    ix, iy = _integral(x), _integral(y)
    ix2, iy2, ixy = _integral(x*x), _integral(y*y), _integral(x*y)
    half = window_size // 2
    n = window_size * window_size
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    total = 0.0
    count = 0
    for cy in range(half, h-half):
        y0, y1 = cy-half, cy+half+1
        for cx in range(half, w-half):
            if region_x_mask is not None and not bool(region_x_mask[cx]):
                continue
            x0, x1 = cx-half, cx+half+1
            sx = _rect_sum(ix, x0, y0, x1, y1)
            sy = _rect_sum(iy, x0, y0, x1, y1)
            sx2 = _rect_sum(ix2, x0, y0, x1, y1)
            sy2 = _rect_sum(iy2, x0, y0, x1, y1)
            sxy = _rect_sum(ixy, x0, y0, x1, y1)
            mux, muy = sx/n, sy/n
            varx = max(0.0, (sx2 - sx*sx/n)/(n-1))
            vary = max(0.0, (sy2 - sy*sy/n)/(n-1))
            cov = (sxy - sx*sy/n)/(n-1)
            num = (2*mux*muy+c1)*(2*cov+c2)
            den = (mux*mux+muy*muy+c1)*(varx+vary+c2)
            total += 1.0 if den == 0 else num/den
            count += 1
    return total/count if count else math.nan


def seam_mask(width: int, half_width_deg: float) -> np.ndarray:
    if not (0 < half_width_deg < 90):
        raise ValueError("seam half-width must be >0 and <90 degrees")
    x = np.arange(width, dtype=float)
    half_px = width * half_width_deg / 360.0
    return (np.abs(x - width*0.25) <= half_px) | (np.abs(x - width*0.75) <= half_px)


def compute_metrics(gt_path: Path, candidate_path: Path, seam_half_width_deg: float) -> dict[str, float]:
    ref = load_rgb(gt_path)
    cand = load_rgb(candidate_path)
    if ref.shape != cand.shape:
        raise ValueError(f"Image dimensions differ: GT {ref.shape} vs candidate {cand.shape}")
    diff = ref - cand
    mse = float(np.mean(diff*diff))
    mae = float(np.mean(np.abs(diff)))
    psnr = math.inf if mse == 0 else 10*math.log10((255*255)/mse)
    ssim = luma_ssim(ref, cand)
    h, w, _ = ref.shape
    mask_x = seam_mask(w, seam_half_width_deg)
    seam_diff = diff[:, mask_x, :]
    seam_mse = float(np.mean(seam_diff*seam_diff))
    seam_mae = float(np.mean(np.abs(seam_diff)))
    seam_psnr = math.inf if seam_mse == 0 else 10*math.log10((255*255)/seam_mse)
    seam_ssim = luma_ssim(ref, cand, region_x_mask=mask_x)
    ref_y = rgb_luma(ref)
    cand_y = rgb_luma(cand)
    ref_grad = ref_y[:, 1:] - ref_y[:, :-1]
    cand_grad = cand_y[:, 1:] - cand_y[:, :-1]
    grad_mask = mask_x[:-1][None, :]
    seam_grad_error = float(np.mean(np.abs(ref_grad-cand_grad)[np.broadcast_to(grad_mask, ref_grad.shape)]))
    return {
        "mse": mse, "mae": mae, "psnr": psnr, "ssim": ssim,
        "seamMse": seam_mse, "seamMae": seam_mae, "seamPsnr": seam_psnr,
        "seamSsim": seam_ssim, "seamGradientError": seam_grad_error,
        "seamPixels": int(h * int(mask_x.sum())),
    }


def command_version(binary: str, args: list[str]) -> str | None:
    path = shutil.which(binary)
    if not path:
        return None
    try:
        p = subprocess.run([path, *args], check=False, capture_output=True, text=True, timeout=10)
        text = (p.stdout or p.stderr).strip().splitlines()
        return text[0] if text else path
    except Exception:
        return path


def run_command(cmd: list[str], *, cwd: Path | None = None) -> tuple[float, str, str]:
    t0 = time.perf_counter()
    p = subprocess.run(cmd, cwd=cwd, check=False, capture_output=True, text=True)
    elapsed = (time.perf_counter() - t0) * 1000.0
    if p.returncode != 0:
        raise RuntimeError(f"Command failed ({p.returncode}): {' '.join(cmd)}\nSTDOUT:\n{p.stdout}\nSTDERR:\n{p.stderr}")
    return elapsed, p.stdout, p.stderr


def build_ffmpeg_command(ffmpeg: str, input_path: Path, output_path: Path, width: int, height: int,
                         fov_deg: float, interpolation: str = "linear") -> list[str]:
    filt = (f"v360=input=dfisheye:output=equirect:w={width}:h={height}:"
            f"ih_fov={fov_deg:g}:iv_fov={fov_deg:g}:interp={interpolation}:v_flip=1")
    return [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(input_path),
            "-vf", filt, "-frames:v", "1", str(output_path)]


def run_ffmpeg(input_path: Path, output_path: Path, width: int, height: int, fov_deg: float,
               repeats: int, warmup: int, ffmpeg_bin: str, interpolation: str) -> tuple[list[float], str]:
    ffmpeg = shutil.which(ffmpeg_bin)
    if not ffmpeg:
        raise FileNotFoundError(f"FFmpeg executable not found: {ffmpeg_bin}")
    cmd = build_ffmpeg_command(ffmpeg, input_path, output_path, width, height, fov_deg, interpolation)
    for _ in range(max(0, warmup)):
        run_command(cmd)
    timings = []
    for _ in range(max(1, repeats)):
        ms, _, _ = run_command(cmd)
        timings.append(ms)
    return timings, " ".join(cmd)


def split_dual_for_hugin(dual_path: Path, work: Path) -> tuple[Path, Path]:
    with Image.open(dual_path) as im:
        rgb = im.convert("RGB")
        w, h = rgb.size
        if w != 2*h:
            raise ValueError(f"Hugin adapter currently expects 2:1 side-by-side dual-fisheye input; got {w}×{h}")
        # Preserve model orientation: right lens looks toward yaw 0°, left lens toward yaw 180°.
        left = rgb.crop((0, 0, h, h))
        right = rgb.crop((h, 0, 2*h, h))
        right_path, left_path = work / "right.png", work / "left.png"
        right.save(right_path)
        left.save(left_path)
        return right_path, left_path


def hugin_tools() -> dict[str, str] | None:
    names = ["pto_gen", "pto_var", "pano_modify", "hugin_executor"]
    found = {name: shutil.which(name) for name in names}
    return found if all(found.values()) else None


def prepare_hugin_project(dual_path: Path, work: Path, width: int, height: int, fov_deg: float,
                          tools: dict[str, str]) -> tuple[Path, list[str]]:
    right, left = split_dual_for_hugin(dual_path, work)
    project0 = work / "project.pto"
    project1 = work / "project_pos.pto"
    project2 = work / "project_final.pto"
    commands: list[str] = []

    cmd = [tools["pto_gen"], "-o", str(project0), "-p", "2", "-f", f"{fov_deg:g}", str(right), str(left)]
    run_command(cmd, cwd=work); commands.append(" ".join(cmd))
    cmd = [tools["pto_var"], "--set=y=i*180,p=0,r=0", "-o", str(project1), str(project0)]
    run_command(cmd, cwd=work); commands.append(" ".join(cmd))
    cmd = [tools["pano_modify"], "-p", "2", "--fov=360x180", f"--canvas={width}x{height}",
           f"--crop=0,{width},0,{height}", "--output-type=N", "--ldr-file=PNG", "-o", str(project2), str(project1)]
    run_command(cmd, cwd=work); commands.append(" ".join(cmd))
    return project2, commands


def run_hugin(dual_path: Path, output_path: Path, width: int, height: int, fov_deg: float,
              repeats: int, warmup: int) -> tuple[list[float], str]:
    tools = hugin_tools()
    if not tools:
        raise FileNotFoundError("Required Hugin CLI tools not found (pto_gen, pto_var, pano_modify, hugin_executor)")
    with tempfile.TemporaryDirectory(prefix="stitch360-hugin-") as td:
        work = Path(td)
        project, setup_commands = prepare_hugin_project(dual_path, work, width, height, fov_deg, tools)
        prefix = work / "hugin_out"
        cmd = [tools["hugin_executor"], "--stitching", f"--prefix={prefix}", str(project)]
        for _ in range(max(0, warmup)):
            run_command(cmd, cwd=work)
        timings = []
        for _ in range(max(1, repeats)):
            for p in work.glob("hugin_out*"):
                if p.is_file() and p != project:
                    try: p.unlink()
                    except OSError: pass
            ms, _, _ = run_command(cmd, cwd=work)
            timings.append(ms)
        candidates = sorted(work.glob("hugin_out*.png"))
        if not candidates:
            candidates = sorted(work.glob("hugin_out*"))
        if not candidates:
            raise RuntimeError("Hugin finished but no panorama output was found")
        # Prefer exact prefix.png if present.
        chosen = next((p for p in candidates if p.name == "hugin_out.png"), candidates[0])
        # Hugin uses the conventional equirectangular vertical axis (north at top),
        # while the validated Stitch 360 research core preserves the legacy raw
        # convention (south at top). Apply one fixed vertical convention adapter;
        # this is global and never optimized per image.
        with Image.open(chosen) as im:
            im.convert("RGB").transpose(Image.Transpose.FLIP_TOP_BOTTOM).save(output_path)
        return timings, " ; ".join([*setup_commands, " ".join(cmd), "[fixed adapter: vertical flip]"])


def summarize_timings(timings: Iterable[float]) -> tuple[float, float, float]:
    vals = list(timings)
    return float(statistics.median(vals)), float(min(vals)), float(max(vals))


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    keys = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader(); w.writerows(rows)


def tool_environment() -> dict:
    return {
        "python": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "ffmpeg": command_version("ffmpeg", ["-version"]),
        "hugin_executor": command_version("hugin_executor", ["--help"]),
        "pto_gen": command_version("pto_gen", ["--help"]),
        "pto_var": command_version("pto_var", ["--help"]),
        "pano_modify": command_version("pano_modify", ["--help"]),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle", type=Path, required=True, help="Extracted browser baseline bundle directory")
    ap.add_argument("--out", type=Path, default=Path("benchmark-output"))
    ap.add_argument("--methods", default="stitch360,ffmpeg,hugin", help="Comma-separated: stitch360,ffmpeg,hugin")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--warmup", type=int, default=1)
    ap.add_argument("--ffmpeg-bin", default="ffmpeg")
    ap.add_argument("--ffmpeg-interp", default="linear", choices=["nearest", "linear", "cubic", "lanczos"])
    ap.add_argument("--strict-missing-tools", action="store_true")
    args = ap.parse_args(argv)

    bundle = args.bundle.resolve()
    out = args.out.resolve(); out.mkdir(parents=True, exist_ok=True)
    images_out = out / "outputs"; images_out.mkdir(exist_ok=True)
    methods_requested = {m.strip().lower() for m in args.methods.split(",") if m.strip()}
    rows = read_manifest(bundle)
    results: list[dict] = []
    command_log: list[str] = []
    env = tool_environment()
    (out / "environment.json").write_text(json.dumps(env, indent=2), encoding="utf-8")

    for idx, item in enumerate(rows, start=1):
        width, height = int(float(item["width"])), int(float(item["height"]))
        fov = float(item["fovDeg"])
        seam_deg = float(item["seamHalfWidthDeg"])
        gain, fov_delta = float(item["rightLensGain"]), float(item["generatorFovDelta"])
        condition = classify_condition(gain, fov_delta)
        gt = bundle / item["groundTruth"]
        dual = bundle / item["dualFisheye"]
        s360 = bundle / item["stitch360"]
        base = {
            "id": item["id"], "image": item["image"], "condition": condition,
            "width": width, "height": height, "fovDeg": fov,
            "rightLensGain": gain, "generatorFovDelta": fov_delta,
            "seamHalfWidthDeg": seam_deg,
        }
        print(f"[{idx}/{len(rows)}] {item['image']} ({condition})", flush=True)

        if "stitch360" in methods_requested:
            try:
                metrics = compute_metrics(gt, s360, seam_deg)
                runtime = float(item.get("stitch360RuntimeMs") or math.nan)
                results.append({**base, "method": METHOD_STITCH360, "status": "ok", **metrics,
                                "runtimeMs": runtime, "runtimeMinMs": runtime, "runtimeMaxMs": runtime,
                                "repeats": 1, "toolVersion": "browser bundle", "output": str(s360.relative_to(bundle)), "command": "browser Stitch 360"})
            except Exception as exc:
                results.append({**base, "method": METHOD_STITCH360, "status": f"error: {exc}",
                                **{k: math.nan for k in METRIC_COLUMNS}, "runtimeMs": math.nan, "runtimeMinMs": math.nan,
                                "runtimeMaxMs": math.nan, "repeats": 0, "toolVersion": "browser bundle", "output": "", "command": ""})

        if "ffmpeg" in methods_requested:
            output = images_out / f"{item['id']}__ffmpeg.png"
            try:
                timings, command = run_ffmpeg(dual, output, width, height, fov, args.repeats, args.warmup,
                                              args.ffmpeg_bin, args.ffmpeg_interp)
                med, lo, hi = summarize_timings(timings)
                metrics = compute_metrics(gt, output, seam_deg)
                command_log.append(f"{item['id']}\tFFmpeg\t{command}")
                results.append({**base, "method": METHOD_FFMPEG, "status": "ok", **metrics,
                                "runtimeMs": med, "runtimeMinMs": lo, "runtimeMaxMs": hi, "repeats": len(timings),
                                "toolVersion": env.get("ffmpeg") or "", "output": str(output.relative_to(out)), "command": command})
            except FileNotFoundError as exc:
                if args.strict_missing_tools: raise
                results.append({**base, "method": METHOD_FFMPEG, "status": f"skipped: {exc}",
                                **{k: math.nan for k in METRIC_COLUMNS}, "runtimeMs": math.nan, "runtimeMinMs": math.nan,
                                "runtimeMaxMs": math.nan, "repeats": 0, "toolVersion": "", "output": "", "command": ""})
            except Exception as exc:
                results.append({**base, "method": METHOD_FFMPEG, "status": f"error: {exc}",
                                **{k: math.nan for k in METRIC_COLUMNS}, "runtimeMs": math.nan, "runtimeMinMs": math.nan,
                                "runtimeMaxMs": math.nan, "repeats": 0, "toolVersion": env.get("ffmpeg") or "", "output": "", "command": ""})

        if "hugin" in methods_requested:
            output = images_out / f"{item['id']}__hugin.png"
            try:
                timings, command = run_hugin(dual, output, width, height, fov, args.repeats, args.warmup)
                med, lo, hi = summarize_timings(timings)
                metrics = compute_metrics(gt, output, seam_deg)
                command_log.append(f"{item['id']}\tHugin\t{command}")
                results.append({**base, "method": METHOD_HUGIN, "status": "ok", **metrics,
                                "runtimeMs": med, "runtimeMinMs": lo, "runtimeMaxMs": hi, "repeats": len(timings),
                                "toolVersion": env.get("hugin_executor") or "", "output": str(output.relative_to(out)), "command": command})
            except FileNotFoundError as exc:
                if args.strict_missing_tools: raise
                results.append({**base, "method": METHOD_HUGIN, "status": f"skipped: {exc}",
                                **{k: math.nan for k in METRIC_COLUMNS}, "runtimeMs": math.nan, "runtimeMinMs": math.nan,
                                "runtimeMaxMs": math.nan, "repeats": 0, "toolVersion": "", "output": "", "command": ""})
            except Exception as exc:
                results.append({**base, "method": METHOD_HUGIN, "status": f"error: {exc}",
                                **{k: math.nan for k in METRIC_COLUMNS}, "runtimeMs": math.nan, "runtimeMinMs": math.nan,
                                "runtimeMaxMs": math.nan, "repeats": 0, "toolVersion": env.get("hugin_executor") or "", "output": "", "command": ""})

    write_csv(out / "baseline_raw.csv", results)
    (out / "commands.log").write_text("\n".join(command_log) + ("\n" if command_log else ""), encoding="utf-8")
    ok = sum(r["status"] == "ok" for r in results)
    report = {
        "bundle": str(bundle), "methodsRequested": sorted(methods_requested), "rows": len(results), "successfulRows": ok,
        "repeats": args.repeats, "warmup": args.warmup, "ffmpegInterpolation": args.ffmpeg_interp,
        "note": "Runtime is wall-clock method execution. Stitch 360 runtime comes from the browser bundle; FFmpeg/Hugin runtimes include external process execution.",
    }
    (out / "BENCHMARK_RUN.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {out/'baseline_raw.csv'} ({ok}/{len(results)} successful method rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
