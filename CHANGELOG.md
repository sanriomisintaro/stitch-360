# Changelog

## v1.0.0 — 2026-10-01

- Modularized projection, bilinear sampling, angular feather blending, and DOM-free stitcher core.
- Froze the publication configuration at FOV 185°, radius scale 0.965, left roll 0°, right roll +0.5°, and gamma 2.0.
- Added six procedural synthetic reference panoramas and C0–C3 perturbation workflows.
- Added MSE, MAE, PSNR, luminance SSIM, seam-band metrics, overlap NCC, and seam diagnostics.
- Added gamma-ablation statistics and runtime benchmarking.
- Added reproducible FFmpeg `v360` baseline workflow; Hugin utilities are retained as an optional extension but are not reported in the v1.0.0 manuscript.
- Added 22-image real-camera study metadata (1 development image + 21 independent tests); raw camera JPEGs remain outside the public repository for privacy/redistribution reasons.
- Added published summary tables, release verification, and continuous integration.
