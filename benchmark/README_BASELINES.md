# External baseline workflow

The v1.0.0 manuscript reports **FFmpeg `v360`** as the reproducible external direct-projection baseline. Hugin-related code is retained only as an optional extension for future experiments and is not part of the reported manuscript results.

# Sprint 5 external baselines

This directory contains the offline comparison layer for Stitch 360.

## Why a browser-exported bundle?

The exporter freezes the **exact same dual-fisheye raster** that Stitch 360 processed. FFmpeg and Hugin therefore receive identical pixels rather than a separately re-generated approximation. This is important for paired scene-level tests.

## FFmpeg

The runner uses the `v360` filter with `input=dfisheye`, `output=equirect`, matched dimensions/FOV, and bilinear (`linear`) interpolation. A fixed vertical convention adapter is applied because the validated legacy Stitch 360 raw buffer uses the opposite vertical equirectangular direction from conventional panorama tools.

## Hugin

The Hugin path is intentionally fixed-geometry rather than test-set optimized:

```text
dual_fisheye.png
  -> split right/left square circular-fisheye images
  -> pto_gen (circular fisheye, fixed FOV)
  -> pto_var (yaw 0° / 180°, pitch 0°, roll 0°)
  -> pano_modify (equirectangular, 360×180°, fixed canvas)
  -> hugin_executor --stitching
  -> fixed vertical convention adapter
```

This preserves Hugin's established remapping/blending pipeline while avoiding per-test-image geometric optimization against the answer.

## Preflight

```bash
ffmpeg -version
ffmpeg -filters | grep v360
pto_gen --help
pto_var --help
pano_modify --help
hugin_executor --help
```

The Python runner stores discovered versions in `environment.json`.

## Demonstration fixture

`example/demo_bundle` is generated from a coordinate pattern and exists only to verify tool integration:

```bash
python example/create_coordinate_fixture.py
python baseline_benchmark.py \
  --bundle example/demo_bundle \
  --out example/demo_output \
  --methods ffmpeg \
  --repeats 2 \
  --warmup 0
```

Do not use its quality values in the paper.
