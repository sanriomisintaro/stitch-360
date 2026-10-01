# Stitch 360 Sprint 4 — Reproducible Statistical Analysis

Sprint 4 converts the raw CSV exported by the Sprint 3 browser experiment into analysis-ready tables, inferential statistics, confidence intervals, and figures.

## What this pipeline does

For one or more `stitch360-sprint3-raw.csv` files it produces:

- combined, validated raw data;
- condition labels C0–C3 derived from right-lens gain and generator FOV mismatch;
- mean, sample SD, median, and percentile-bootstrap 95% CI per condition × gamma;
- Friedman repeated-measures tests across gamma settings;
- paired Wilcoxon signed-rank tests;
- Holm correction for multiple pairwise tests;
- paired rank-biserial effect size;
- Cliff's delta as an additional distributional effect-size descriptor;
- publication-oriented figures at 300 dpi;
- automatic Table 1–4 exports in CSV and Markdown.

## Install

From the Sprint 4 root:

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r analysis/requirements.txt
```

## Recommended experimental data collection

Export Sprint 3 raw CSV separately for the following conditions:

- **C0 Clean**: right-lens gain = 1.00, generator FOV delta = 0°
- **C1 Photometric**: right-lens gain = 1.05, generator FOV delta = 0°
- **C2 Calibration**: right-lens gain = 1.00, generator FOV delta = +1°
- **C3 Combined**: right-lens gain = 1.05, generator FOV delta = +1°

Do not pool these conditions manually. The script derives the condition label from the CSV fields and analyzes each condition separately.

## Run the analysis

Reference-gamma analysis, with γ=2.0 as the prespecified reference:

```bash
python analysis/stitch360_analysis.py \
  --input results/C0.csv results/C1.csv results/C2.csv results/C3.csv \
  --out analysis-output \
  --reference-gamma 2.0
```

For exploratory all-pair comparisons:

```bash
python analysis/stitch360_analysis.py \
  --input results/C0.csv results/C1.csv results/C2.csv results/C3.csv \
  --out analysis-output-all-pairs \
  --all-pairs
```

## Main outputs

- `table1_experiment_conditions.csv/md`
- `table2_full_panorama_quality.csv/md`
- `table3_seam_quality.csv/md`
- `table4_runtime.csv/md`
- `friedman_tests.csv`
- `pairwise_wilcoxon_holm.csv`
- `group_summary_bootstrap.csv`
- `descriptive_optima.csv`
- `figure_psnr_vs_gamma.png`
- `figure_ssim_vs_gamma.png`
- `figure_seam_psnr_vs_gamma.png`
- `figure_seam_ssim_vs_gamma.png`
- `figure_runtime_vs_gamma.png`

## Statistical interpretation

The gamma ablation is a repeated-measures experiment because every ground-truth panorama is reconstructed under every gamma setting. Accordingly, the main omnibus test is Friedman and pairwise follow-ups use the paired Wilcoxon signed-rank test. Holm adjustment controls the family-wise error rate across the pairwise comparisons performed for a metric within a condition.

The pipeline reports paired rank-biserial correlation because it is naturally aligned with paired Wilcoxon testing. Cliff's delta is also exported because it was part of the planned analysis, but it should be described as an additional distributional effect-size measure rather than the primary paired effect size.

Bootstrap confidence intervals use deterministic percentile resampling of image-level observations with a fixed seed. The default is 10,000 resamples.

## Important scientific boundary

Sprint 4 analyzes the **synthetic controlled experiment** only. It must not be used to claim that Stitch 360 outperforms FFmpeg, Hugin, manufacturer software, or other real-camera pipelines. Baseline comparisons and a real dual-fisheye dataset require a separate experimental stage.
