# Final study design — Stitch 360 v1.0.0

## Evidence stream A — controlled synthetic ground truth

Six procedurally generated 2:1 reference panoramas (1024 × 512 pixels) are included in `data/synthetic/fixtures/`: gradient, checkerboard/high-frequency, low-texture, urban-like, natural-like, and mixed-pattern stimuli.

Conditions: C0 clean (gain 1.00, ΔFOV 0°); C1 photometric (gain 1.05, ΔFOV 0°); C2 calibration (gain 1.00, ΔFOV +1°); C3 combined (gain 1.05, ΔFOV +1°). Gamma ablation: 0.5, 1.0, 1.5, 2.0, 3.0, 4.0.

Primary metrics: PSNR, luminance SSIM, MAE, seam-band PSNR/SSIM/MAE, seam-gradient error, and runtime.

## Evidence stream B — FFmpeg baseline

FFmpeg `v360` is used as the reproducible external direct-projection baseline. Inputs and output dimensions are matched; the baseline uses 185° horizontal/vertical FOV, linear interpolation, and one fixed vertical-convention adapter. Hugin utilities remain available in code for optional future work but Hugin results are not reported in the v1.0.0 manuscript.

## Evidence stream C — real-camera validation

The camera dataset contains 22 Samsung SM-R210 side-by-side dual-fisheye JPEGs at 5792 × 2896 pixels. `image (6).JPG` is the only development/calibration image. The remaining 21 images are independent tests: 10 indoor/enclosed and 11 outdoor/open-air. No per-image retuning is permitted.

Frozen calibration (`CAL-REAL-01`): FOV 185°, radius scale 0.965, centers (0.25W, 0.50H) and (0.75W, 0.50H), left roll 0°, right roll +0.5°, global yaw 0°, gamma 2.0.

Without registered physical ground truth, real-camera PSNR/SSIM must not be interpreted as reconstruction accuracy. Use overlap NCC, seam luminance/RGB jumps, seam-gradient ratio, horizontal total variation, Laplacian variance, runtime, qualitative examples, and explicit limitations.

## Runtime benchmark

Six representative real-camera frames are standardized to 2048 × 1024 input RGBA buffers. The DOM-free JavaScript core is run at 512 × 256, 1024 × 512, and 2048 × 1024 outputs, with three repetitions per image-resolution combination; the median is retained. The reported environment used Node.js 22.16.0.

## Statistical plan

Pair observations by source image. Use Friedman tests for the six-level gamma ablation and paired Wilcoxon signed-rank tests for real-camera comparisons. The calibration development image is excluded from inferential testing. Report mean ± SD alongside the paired tests and interpret seam proxies as diagnostics rather than perceptual ground truth.
