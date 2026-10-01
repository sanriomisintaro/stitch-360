# Stitch 360 v1.0.0

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23073884.svg)](https://doi.org/10.5281/zenodo.23073884)


**Stitch 360** is an open-source, browser-native framework for converting side-by-side dual-fisheye imagery into equirectangular panoramas. The v1.0.0 research release uses a transparent equidistant fisheye model, bilinear source sampling, and angular feather blending, and includes reproducible synthetic, baseline, real-camera, and runtime evaluation utilities.

> Associated manuscript: **Stitch 360: Quality and Computational Performance of a Lightweight Browser-Native Dual-Fisheye Panorama Stitching Framework** (submitted separately; the manuscript itself is intentionally not stored in this repository).

## Why this repository exists

This repository is the software and reproducibility artifact underlying the study. It contains the application code, experiment pages, six procedural synthetic reference panoramas, calibration metadata, analysis scripts, benchmark utilities, automated tests, and the summary tables reported in the manuscript. It does **not** contain the journal submission files, reviewer suggestions, cover letter, or the original real-camera photographs.

## Frozen publication configuration

The real-camera evaluation used one development image to select a single calibration that was then frozen for all 21 independent test images:

| Parameter | Value |
|---|---:|
| Per-lens FOV | 185° |
| Radius scale | 0.965 |
| Left lens center | (0.25 W, 0.50 H) |
| Right lens center | (0.75 W, 0.50 H) |
| Left roll | 0.0° |
| Right roll | +0.5° |
| Global yaw | 0.0° |
| Feather exponent γ | 2.0 |

The public v1.0.0 `DEFAULT_CONFIG` is synchronized with this frozen configuration.

## Study data represented here

### Synthetic branch

The controlled experiment used **six procedurally generated 2:1 panoramas at 1024 × 512 pixels**:

- gradient;
- checkerboard/high-frequency;
- low-texture;
- urban-like edge structure;
- natural-like spatial variability;
- mixed-pattern content.

They are stored in `data/synthetic/fixtures/`. Four predefined conditions were evaluated:

- **C0 Clean:** right-lens gain 1.00; generator ΔFOV 0°;
- **C1 Photometric:** right-lens gain 1.05; generator ΔFOV 0°;
- **C2 Calibration:** right-lens gain 1.00; generator ΔFOV +1°;
- **C3 Combined:** right-lens gain 1.05; generator ΔFOV +1°.

The gamma ablation used `γ ∈ {0.5, 1.0, 1.5, 2.0, 3.0, 4.0}`.

### Real-camera branch

The study used **22 original 5792 × 2896 JPEG dual-fisheye images from a Samsung SM-R210**: one indoor image (`image (6).JPG`) for development/calibration and **21 independent test images**. The independent set contained 10 indoor/enclosed scenes and 11 outdoor/open-air scenes.

The original real-camera JPEGs are not committed because some scenes contain identifiable people and redistribution rights/consent must be handled separately. `research/REAL_CAMERA_DATASET_METADATA.csv` provides non-image metadata and the study partition. The manuscript states that originals are available from the corresponding author upon reasonable request, subject to privacy and redistribution considerations.

## External baseline

The manuscript reports a deterministic **FFmpeg `v360`** direct-projection baseline with matched 185° FOV, linear interpolation, 1024 × 512 output, and one fixed vertical-convention adapter. The repository retains optional Hugin support in the benchmark utilities for future work, but **Hugin results are not part of the reported v1.0.0 manuscript results**.

## Directory map

```text
.
├── .github/workflows/       Continuous-integration test workflow
├── docs/                    Browser application + experiment/export pages
│   └── core/                DOM-free projection, sampling, blending, metrics
├── tests/                   JavaScript and Python tests
├── analysis/                Statistical analysis pipeline
├── benchmark/               FFmpeg baseline + optional Hugin utilities
├── data/
│   ├── synthetic/fixtures/  Six procedural panoramas used in the study
│   └── real/README.md       Real-image access/privacy note
├── research/                Study design, metadata, calibration, definitions
├── results/published/       Manuscript summary tables and runtime CSV
└── scripts/                 Test and release verification helpers
```

## Quick start

Serve the browser application locally:

```bash
python -m http.server 8000 -d docs
```

Then open <http://localhost:8000/>.

Research interfaces:

- `experiment.html` — single synthetic round trip;
- `batch-experiment.html` — C0–C3 / gamma-ablation workflow;
- `baseline-export.html` — synthetic bundle for FFmpeg comparison;
- `real-camera-export.html` — frozen-calibration real-camera bundle;
- `tests/test.html` — browser checks.

Install analysis dependencies:

```bash
python -m pip install -r requirements.txt
```

Run all automated tests:

```bash
python scripts/run_all_tests.py
```

or JavaScript tests only:

```bash
npm test
```

Verify the release structure and regenerate checksums:

```bash
python scripts/verify_release.py
```

## Metrics

Synthetic full-reference evaluation includes MSE, MAE, PSNR, luminance SSIM, seam-band PSNR/SSIM/MAE, and seam-gradient error. Real-camera evaluation intentionally avoids PSNR/SSIM as accuracy measures because there is no registered physical equirectangular ground truth. Instead it uses overlap luminance NCC, seam luminance/RGB jump, seam-gradient ratio, horizontal total variation, and Laplacian variance as diagnostics.

## Research-integrity constraints

- Do not tune calibration separately for held-out real-camera images.
- Do not treat no-reference seam metrics as perceptual ground truth.
- Do not use the simulated test/demo fixtures as additional independent empirical observations.
- Do not claim superiority over advanced feature-, depth-, semantic-, or learning-based stitchers from the FFmpeg direct-projection comparison.
- Do not infer energy or carbon savings from browser execution without direct measurement.
- Keep the released code, parameters, result tables, and manuscript synchronized.

## Results included

`results/published/` contains machine-readable versions of the manuscript summary tables for synthetic reconstruction, gamma sensitivity, calibration transfer, FFmpeg comparison, and JavaScript-core runtime scaling. These files are summary outputs; the raw real-camera JPEGs are not redistributed here.

## Citation

See `CITATION.cff`. The archived Stitch 360 v1.0.0 research release is permanently available at https://doi.org/10.5281/zenodo.23073884.

## License

MIT. See `LICENSE`.
