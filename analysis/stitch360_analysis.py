#!/usr/bin/env python3
"""Stitch 360 Sprint 4 statistical analysis pipeline.

Consumes one or more Sprint 3 raw CSV exports and produces reproducible
summary tables, bootstrap confidence intervals, paired inferential tests, and
publication-oriented figures.

The script deliberately does not infer scientific conclusions beyond the
observed input data. Synthetic and real-camera experiments must be reported as
separate evidence streams.
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import sys
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
from typing import Iterable, Sequence

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy
from scipy.stats import friedmanchisquare, wilcoxon

REQUIRED_COLUMNS = {
    "image", "gamma", "width", "height", "fovDeg", "radiusScale",
    "rightLensGain", "generatorFovDelta", "seamHalfWidthDeg", "repeats",
    "mse", "mae", "psnr", "ssim", "seamMse", "seamMae", "seamPsnr",
    "seamSsim", "seamGradientError", "seamPixels", "runtimeMs",
    "runtimeMinMs", "runtimeMaxMs", "generatorMs",
}

QUALITY_METRICS = ["psnr", "ssim", "mae"]
SEAM_METRICS = ["seamPsnr", "seamSsim", "seamMae", "seamGradientError"]
RUNTIME_METRICS = ["runtimeMs", "generatorMs"]
ALL_METRICS = QUALITY_METRICS + SEAM_METRICS + ["runtimeMs"]
HIGHER_IS_BETTER = {"psnr", "ssim", "seamPsnr", "seamSsim"}


@dataclass(frozen=True)
class AnalysisConfig:
    bootstrap_resamples: int = 10_000
    seed: int = 360
    reference_gamma: float = 2.0
    alpha: float = 0.05


def _isclose(a: float, b: float, tol: float = 1e-9) -> bool:
    return abs(float(a) - float(b)) <= tol


def classify_condition(gain: float, fov_delta: float) -> str:
    """Assign the recommended Sprint 3 condition label."""
    gain_clean = _isclose(gain, 1.0)
    fov_clean = _isclose(fov_delta, 0.0)
    if gain_clean and fov_clean:
        return "C0 Clean"
    if (not gain_clean) and fov_clean:
        return "C1 Photometric"
    if gain_clean and (not fov_clean):
        return "C2 Calibration"
    if (not gain_clean) and (not fov_clean):
        return "C3 Combined"
    return f"Custom gain={gain:g}, dFOV={fov_delta:g}"


def load_raw_csvs(paths: Sequence[Path]) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for path in paths:
        df = pd.read_csv(path)
        missing = REQUIRED_COLUMNS.difference(df.columns)
        if missing:
            raise ValueError(f"{path}: missing required columns: {sorted(missing)}")
        df = df.copy()
        df["source_csv"] = path.name
        frames.append(df)
    if not frames:
        raise ValueError("No CSV inputs were supplied.")
    out = pd.concat(frames, ignore_index=True)

    numeric = [
        "gamma", "width", "height", "fovDeg", "radiusScale", "rightLensGain",
        "generatorFovDelta", "seamHalfWidthDeg", "repeats", "mse", "mae",
        "psnr", "ssim", "seamMse", "seamMae", "seamPsnr", "seamSsim",
        "seamGradientError", "seamPixels", "runtimeMs", "runtimeMinMs",
        "runtimeMaxMs", "generatorMs",
    ]
    for col in numeric:
        out[col] = pd.to_numeric(out[col], errors="coerce")

    if out[["image", "gamma"]].isna().any().any():
        raise ValueError("Rows with missing image or gamma values are not permitted.")

    out["condition"] = [
        classify_condition(g, f)
        for g, f in zip(out["rightLensGain"], out["generatorFovDelta"])
    ]
    out["resolution"] = out["width"].astype("Int64").astype(str) + "×" + out["height"].astype("Int64").astype(str)
    return out


def sample_sd(values: np.ndarray) -> float:
    values = values[np.isfinite(values)]
    return float(np.std(values, ddof=1)) if len(values) >= 2 else math.nan


def bootstrap_mean_ci(
    values: Iterable[float],
    *,
    resamples: int = 10_000,
    confidence: float = 0.95,
    seed: int = 360,
) -> tuple[float, float]:
    """Percentile bootstrap CI for the arithmetic mean."""
    x = np.asarray(list(values), dtype=float)
    x = x[np.isfinite(x)]
    if len(x) == 0:
        return math.nan, math.nan
    if len(x) == 1:
        return float(x[0]), float(x[0])
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(x), size=(resamples, len(x)))
    means = x[idx].mean(axis=1)
    q = (1.0 - confidence) / 2.0
    lo, hi = np.quantile(means, [q, 1.0 - q])
    return float(lo), float(hi)


def cliff_delta(x: Iterable[float], y: Iterable[float]) -> float:
    """Conventional Cliff's delta using all x-y pair comparisons."""
    a = np.asarray(list(x), dtype=float)
    b = np.asarray(list(y), dtype=float)
    a = a[np.isfinite(a)]
    b = b[np.isfinite(b)]
    if len(a) == 0 or len(b) == 0:
        return math.nan
    diff = a[:, None] - b[None, :]
    return float((np.count_nonzero(diff > 0) - np.count_nonzero(diff < 0)) / diff.size)


def paired_rank_biserial(x: Iterable[float], y: Iterable[float]) -> float:
    """Paired rank-biserial effect size aligned with paired Wilcoxon testing."""
    d = np.asarray(list(x), dtype=float) - np.asarray(list(y), dtype=float)
    d = d[np.isfinite(d)]
    d = d[d != 0]
    if len(d) == 0:
        return 0.0
    abs_d = np.abs(d)
    order = np.argsort(abs_d)
    ranks = np.empty(len(d), dtype=float)
    sorted_abs = abs_d[order]
    i = 0
    rank = 1
    while i < len(d):
        j = i + 1
        while j < len(d) and sorted_abs[j] == sorted_abs[i]:
            j += 1
        avg = (rank + (rank + (j - i) - 1)) / 2.0
        ranks[order[i:j]] = avg
        rank += j - i
        i = j
    pos = ranks[d > 0].sum()
    neg = ranks[d < 0].sum()
    denom = pos + neg
    return float((pos - neg) / denom) if denom else 0.0


def holm_adjust(p_values: Sequence[float]) -> list[float]:
    """Holm step-down adjusted p-values, preserving input order."""
    p = np.asarray(p_values, dtype=float)
    m = len(p)
    if m == 0:
        return []
    order = np.argsort(p)
    adjusted_sorted = np.empty(m, dtype=float)
    running = 0.0
    for rank, idx in enumerate(order):
        candidate = (m - rank) * p[idx]
        running = max(running, candidate)
        adjusted_sorted[rank] = min(1.0, running)
    adjusted = np.empty(m, dtype=float)
    for rank, idx in enumerate(order):
        adjusted[idx] = adjusted_sorted[rank]
    return adjusted.tolist()


def summarize_metric_groups(df: pd.DataFrame, metrics: Sequence[str], cfg: AnalysisConfig) -> pd.DataFrame:
    rows: list[dict] = []
    groups = df.groupby(["condition", "gamma"], sort=True, dropna=False)
    for (condition, gamma), group in groups:
        for metric in metrics:
            vals = group[metric].to_numpy(dtype=float)
            vals = vals[np.isfinite(vals)]
            lo, hi = bootstrap_mean_ci(
                vals,
                resamples=cfg.bootstrap_resamples,
                seed=cfg.seed + int(round(float(gamma) * 100)) + sum(map(ord, str(metric))),
            )
            rows.append({
                "condition": condition,
                "gamma": float(gamma),
                "metric": metric,
                "n": int(len(vals)),
                "mean": float(np.mean(vals)) if len(vals) else math.nan,
                "sd": sample_sd(vals),
                "median": float(np.median(vals)) if len(vals) else math.nan,
                "ci95_low": lo,
                "ci95_high": hi,
            })
    return pd.DataFrame(rows)


def _paired_vectors(group: pd.DataFrame, metric: str, gamma_a: float, gamma_b: float) -> tuple[np.ndarray, np.ndarray, list[str]]:
    a = group[np.isclose(group["gamma"], gamma_a)][["image", metric]].rename(columns={metric: "a"})
    b = group[np.isclose(group["gamma"], gamma_b)][["image", metric]].rename(columns={metric: "b"})
    pair = a.merge(b, on="image", how="inner").dropna()
    return pair["a"].to_numpy(dtype=float), pair["b"].to_numpy(dtype=float), pair["image"].astype(str).tolist()


def paired_wilcoxon(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    if len(x) == 0:
        return math.nan, math.nan
    d = x - y
    if np.allclose(d, 0):
        return 0.0, 1.0
    res = wilcoxon(x, y, zero_method="wilcox", alternative="two-sided", method="auto")
    return float(res.statistic), float(res.pvalue)


def pairwise_gamma_tests(df: pd.DataFrame, metrics: Sequence[str], cfg: AnalysisConfig, all_pairs: bool) -> pd.DataFrame:
    rows: list[dict] = []
    for condition, group in df.groupby("condition", sort=True):
        gammas = sorted(float(v) for v in group["gamma"].dropna().unique())
        if all_pairs:
            pairs = list(combinations(gammas, 2))
        else:
            ref_matches = [g for g in gammas if _isclose(g, cfg.reference_gamma, 1e-7)]
            if not ref_matches:
                continue
            ref = ref_matches[0]
            pairs = [(g, ref) for g in gammas if not _isclose(g, ref, 1e-7)]

        for metric in metrics:
            metric_rows: list[dict] = []
            for ga, gb in pairs:
                x, y, _ = _paired_vectors(group, metric, ga, gb)
                stat, p = paired_wilcoxon(x, y)
                diff = x - y
                metric_rows.append({
                    "condition": condition,
                    "metric": metric,
                    "gamma_a": ga,
                    "gamma_b": gb,
                    "n_pairs": int(len(x)),
                    "mean_a": float(np.mean(x)) if len(x) else math.nan,
                    "mean_b": float(np.mean(y)) if len(y) else math.nan,
                    "mean_diff_a_minus_b": float(np.mean(diff)) if len(diff) else math.nan,
                    "wilcoxon_W": stat,
                    "p_raw": p,
                    "cliffs_delta": cliff_delta(x, y),
                    "paired_rank_biserial": paired_rank_biserial(x, y),
                })
            valid_ps = [r["p_raw"] for r in metric_rows if np.isfinite(r["p_raw"])]
            adj = holm_adjust(valid_ps)
            j = 0
            for r in metric_rows:
                if np.isfinite(r["p_raw"]):
                    r["p_holm"] = adj[j]
                    j += 1
                else:
                    r["p_holm"] = math.nan
                r["significant_holm"] = bool(np.isfinite(r["p_holm"]) and r["p_holm"] < cfg.alpha)
                rows.append(r)
    return pd.DataFrame(rows)


def friedman_tests(df: pd.DataFrame, metrics: Sequence[str]) -> pd.DataFrame:
    rows: list[dict] = []
    for condition, group in df.groupby("condition", sort=True):
        gammas = sorted(float(v) for v in group["gamma"].dropna().unique())
        if len(gammas) < 3:
            continue
        for metric in metrics:
            pivot = group.pivot_table(index="image", columns="gamma", values=metric, aggfunc="first")
            cols = [g for g in gammas if g in pivot.columns]
            complete = pivot[cols].dropna()
            if len(complete) < 2 or len(cols) < 3:
                stat, p = math.nan, math.nan
            else:
                arrays = [complete[g].to_numpy(dtype=float) for g in cols]
                # scipy raises when all arrays are identical constants; this is a valid no-effect case.
                try:
                    res = friedmanchisquare(*arrays)
                    stat, p = float(res.statistic), float(res.pvalue)
                except ValueError:
                    stat, p = 0.0, 1.0
            rows.append({
                "condition": condition,
                "metric": metric,
                "n_images_complete": int(len(complete)),
                "n_gammas": int(len(cols)),
                "friedman_chi2": stat,
                "p_raw": p,
            })
    return pd.DataFrame(rows)


def dataset_table(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for condition, g in df.groupby("condition", sort=True):
        browsers = g["userAgent"].dropna().astype(str).nunique() if "userAgent" in g else 0
        rows.append({
            "condition": condition,
            "n_images": int(g["image"].nunique()),
            "n_rows": int(len(g)),
            "gammas": ", ".join(f"{x:g}" for x in sorted(g["gamma"].unique())),
            "resolutions": ", ".join(sorted(g["resolution"].dropna().astype(str).unique())),
            "right_lens_gain": ", ".join(f"{x:g}" for x in sorted(g["rightLensGain"].dropna().unique())),
            "generator_fov_delta_deg": ", ".join(f"{x:g}" for x in sorted(g["generatorFovDelta"].dropna().unique())),
            "seam_half_width_deg": ", ".join(f"{x:g}" for x in sorted(g["seamHalfWidthDeg"].dropna().unique())),
            "browser_user_agents": int(browsers),
        })
    return pd.DataFrame(rows)


def format_ci_table(summary: pd.DataFrame, metrics: Sequence[str]) -> pd.DataFrame:
    d = summary[summary["metric"].isin(metrics)].copy()
    d["mean_sd"] = d.apply(lambda r: f"{r['mean']:.5g} ± {r['sd']:.5g}" if np.isfinite(r["sd"]) else f"{r['mean']:.5g}", axis=1)
    d["ci95"] = d.apply(lambda r: f"[{r['ci95_low']:.5g}, {r['ci95_high']:.5g}]", axis=1)
    return d[["condition", "gamma", "metric", "n", "mean_sd", "ci95"]]


def save_dataframe(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)


def save_markdown_table(df: pd.DataFrame, path: Path, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        f.write(f"# {title}\n\n")
        try:
            f.write(df.to_markdown(index=False))
        except ImportError:
            # Keep the pipeline dependency-light if optional tabulate is absent.
            f.write("```csv\n")
            f.write(df.to_csv(index=False))
            f.write("```\n")
        f.write("\n")


def plot_metric(summary: pd.DataFrame, metric: str, ylabel: str, path: Path) -> None:
    d = summary[summary["metric"] == metric].copy()
    if d.empty:
        return
    fig, ax = plt.subplots(figsize=(7.2, 4.8))
    for condition, g in d.groupby("condition", sort=True):
        g = g.sort_values("gamma")
        yerr = np.vstack([
            g["mean"].to_numpy() - g["ci95_low"].to_numpy(),
            g["ci95_high"].to_numpy() - g["mean"].to_numpy(),
        ])
        ax.errorbar(g["gamma"], g["mean"], yerr=yerr, capsize=3, label=condition)
    ax.set_xlabel("Feather gamma (γ)")
    ax.set_ylabel(ylabel)
    ax.legend(frameon=False)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=300, bbox_inches="tight")
    plt.close(fig)


def choose_observed_optima(summary: pd.DataFrame) -> pd.DataFrame:
    """Descriptive optima only; not a statistical winner claim."""
    rows: list[dict] = []
    for (condition, metric), g in summary.groupby(["condition", "metric"], sort=True):
        g = g[np.isfinite(g["mean"])].copy()
        if g.empty:
            continue
        idx = g["mean"].idxmax() if metric in HIGHER_IS_BETTER else g["mean"].idxmin()
        r = g.loc[idx]
        rows.append({
            "condition": condition,
            "metric": metric,
            "observed_gamma": float(r["gamma"]),
            "observed_mean": float(r["mean"]),
            "note": "Descriptive maximum/minimum only; consult paired tests and confidence intervals.",
        })
    return pd.DataFrame(rows)


def write_results_note(df: pd.DataFrame, summary: pd.DataFrame, output: Path, cfg: AnalysisConfig) -> None:
    conditions = ", ".join(sorted(df["condition"].unique()))
    gammas = ", ".join(f"{x:g}" for x in sorted(df["gamma"].unique()))
    text = "# Stitch 360 Sprint 4 — Analysis Run\n\n"
    text += f"- Input rows: **{len(df)}**\n"
    text += f"- Unique panorama files: **{df['image'].nunique()}**\n"
    text += f"- Conditions: {conditions}\n"
    text += f"- Gamma values: {gammas}\n"
    text += f"- Bootstrap resamples: {cfg.bootstrap_resamples}\n"
    text += f"- Random seed: {cfg.seed}\n"
    text += f"- Paired Wilcoxon reference gamma (when reference mode is used): {cfg.reference_gamma:g}\n\n"
    text += "## Interpretation boundary\n\n"
    text += "These outputs summarize the supplied Sprint 3 synthetic experiment CSV files. They do not, by themselves, establish real-camera performance, physical-lens robustness, or superiority over FFmpeg/Hugin. Those claims require separate baseline and real-camera experiments.\n"
    (output / "ANALYSIS_RUN.md").write_text(text, encoding="utf-8")


def run_analysis(inputs: Sequence[Path], output: Path, cfg: AnalysisConfig, all_pairs: bool) -> None:
    output.mkdir(parents=True, exist_ok=True)
    df = load_raw_csvs(inputs)
    summary = summarize_metric_groups(df, ALL_METRICS, cfg)
    friedman = friedman_tests(df, ALL_METRICS)
    pairwise = pairwise_gamma_tests(df, ALL_METRICS, cfg, all_pairs=all_pairs)
    table1 = dataset_table(df)
    table2 = format_ci_table(summary, QUALITY_METRICS)
    table3 = format_ci_table(summary, SEAM_METRICS)
    table4 = format_ci_table(summary, ["runtimeMs"])
    optima = choose_observed_optima(summary)

    save_dataframe(df, output / "combined_raw.csv")
    save_dataframe(summary, output / "group_summary_bootstrap.csv")
    save_dataframe(friedman, output / "friedman_tests.csv")
    save_dataframe(pairwise, output / "pairwise_wilcoxon_holm.csv")
    save_dataframe(optima, output / "descriptive_optima.csv")
    save_dataframe(table1, output / "table1_experiment_conditions.csv")
    save_dataframe(table2, output / "table2_full_panorama_quality.csv")
    save_dataframe(table3, output / "table3_seam_quality.csv")
    save_dataframe(table4, output / "table4_runtime.csv")

    environment = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scipy": scipy.__version__,
        "matplotlib": matplotlib.__version__,
        "bootstrap_resamples": cfg.bootstrap_resamples,
        "seed": cfg.seed,
        "reference_gamma": cfg.reference_gamma,
        "alpha": cfg.alpha,
        "all_pairs": bool(all_pairs),
        "inputs": [str(p) for p in inputs],
    }
    (output / "analysis_environment.json").write_text(json.dumps(environment, indent=2), encoding="utf-8")

    save_markdown_table(table1, output / "table1_experiment_conditions.md", "Table 1. Experimental conditions")
    save_markdown_table(table2, output / "table2_full_panorama_quality.md", "Table 2. Full-panorama quality")
    save_markdown_table(table3, output / "table3_seam_quality.md", "Table 3. Seam-region quality")
    save_markdown_table(table4, output / "table4_runtime.md", "Table 4. Runtime")

    plot_metric(summary, "psnr", "PSNR (dB)", output / "figure_psnr_vs_gamma.png")
    plot_metric(summary, "ssim", "SSIM", output / "figure_ssim_vs_gamma.png")
    plot_metric(summary, "seamPsnr", "Seam-band PSNR (dB)", output / "figure_seam_psnr_vs_gamma.png")
    plot_metric(summary, "seamSsim", "Seam-band SSIM", output / "figure_seam_ssim_vs_gamma.png")
    plot_metric(summary, "runtimeMs", "Median reconstruction runtime (ms)", output / "figure_runtime_vs_gamma.png")
    write_results_note(df, summary, output, cfg)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Analyze Stitch 360 Sprint 3 raw CSV exports.")
    p.add_argument("--input", nargs="+", required=True, type=Path, help="One or more stitch360-sprint3-raw.csv files.")
    p.add_argument("--out", type=Path, default=Path("analysis-output"), help="Output directory.")
    p.add_argument("--bootstrap", type=int, default=10_000, help="Bootstrap resamples (default: 10000).")
    p.add_argument("--seed", type=int, default=360, help="Deterministic random seed.")
    p.add_argument("--reference-gamma", type=float, default=2.0, help="Reference gamma for pairwise tests when --all-pairs is not used.")
    p.add_argument("--alpha", type=float, default=0.05, help="Significance level for Holm-adjusted flags.")
    p.add_argument("--all-pairs", action="store_true", help="Compare all gamma pairs instead of each gamma versus the reference gamma.")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    cfg = AnalysisConfig(
        bootstrap_resamples=args.bootstrap,
        seed=args.seed,
        reference_gamma=args.reference_gamma,
        alpha=args.alpha,
    )
    run_analysis(args.input, args.out, cfg, all_pairs=args.all_pairs)
    print(f"Analysis complete: {args.out.resolve()}")


if __name__ == "__main__":
    main()
