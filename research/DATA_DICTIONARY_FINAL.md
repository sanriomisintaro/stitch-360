# Data dictionary — Stitch 360 v1.0.0

## Real-camera metadata

`REAL_CAMERA_DATASET_METADATA.csv` lists image ID, original filename, dimensions, camera model, scene stratum, and study role. The raw JPEGs are not included in Git.

## Frozen calibration

`calibration/CAL-REAL-01.json` records the exact camera-model parameters used for all independent real-camera tests.

## Synthetic batch fields

- `image`: stable procedural panorama identifier
- `gamma`: feather exponent
- `width`, `height`: equirectangular output dimensions
- `fovDeg`: stitcher FOV assumption
- `radiusScale`: accepted lens-circle multiplier
- `rightLensGain`: generator photometric multiplier
- `generatorFovDelta`: generator-only FOV perturbation
- `seamHalfWidthDeg`: half-width of seam-evaluation band
- `mse`, `mae`, `psnr`, `ssim`: global full-reference metrics
- `seamMse`, `seamMae`, `seamPsnr`, `seamSsim`: seam-band metrics
- `seamGradientError`: gradient discrepancy in the seam band
- `runtimeMs`: Stitch 360 processing time

## Real-camera metrics

- overlap luminance NCC: higher indicates stronger projected overlap agreement
- seam luminance/RGB jump: lower indicates smaller crossover photometric discontinuity
- seam-gradient ratio: lower indicates a less prominent crossover relative to its local neighborhood
- horizontal total variation and Laplacian variance: contextual detail descriptors, not perceptual ground truth
- runtime: processing time under the documented benchmark protocol

## Published summary files

`results/published/` contains machine-readable copies of the numerical summary tables reported in the manuscript.
