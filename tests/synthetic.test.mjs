import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLensBasis,
  directionToEquirectangularPixel,
  fisheyePixelToDirection,
} from '../docs/core/projection.js';
import { generateDualFisheyeImageData } from '../docs/core/synthetic-generator.js';
import { stitchImageData } from '../docs/core/stitcher-core.js';
import { computePSNR, computeRgbMSE } from '../docs/core/metrics.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('fisheye center maps back to the right optical axis', () => {
  const basis = createLensBasis(true, 0, 0);
  const direction = fisheyePixelToDirection(100, 100, basis, 100, 100, 50, Math.PI / 2, 100);
  assert.ok(direction);
  assert.ok(near(direction[0], 1));
  assert.ok(near(direction[1], 0));
  assert.ok(near(direction[2], 0));
});

test('direction +X maps to the horizontal center of equirectangular image', () => {
  const p = directionToEquirectangularPixel([1, 0, 0], 400, 200, 0);
  assert.ok(near(p.x, 200));
  assert.ok(near(p.y, 100));
});

test('MSE and PSNR report perfect equality correctly', () => {
  const a = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
  assert.equal(computeRgbMSE(a, a), 0);
  assert.equal(computePSNR(a, a), Infinity);
});

test('uniform panorama survives synthetic dual-fisheye round trip', async () => {
  const w = 64;
  const h = 32;
  const gt = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < gt.length; i += 4) {
    gt[i] = 80;
    gt[i + 1] = 130;
    gt[i + 2] = 200;
    gt[i + 3] = 255;
  }

  // Use a deliberately wide synthetic test geometry here so this invariant
  // tests resampling/blending rather than the narrower publication calibration.
  const testConfig = { fovDeg: 200.0, radiusScale: 0.985, rollDeg: { left: 0.0, right: 0.0 } };
  const dual = await generateDualFisheyeImageData({
    panoData: gt,
    panoW: w,
    panoH: h,
    config: testConfig,
    yieldEveryRows: 0,
  });
  const reconstructed = await stitchImageData({
    srcData: dual.data,
    srcW: dual.width,
    srcH: dual.height,
    panoW: w,
    panoH: h,
    config: testConfig,
    yieldEveryRows: 0,
  });

  const psnr = computePSNR(gt, reconstructed.data);
  assert.ok(psnr > 45, `Expected high round-trip PSNR for uniform input, got ${psnr}`);
});

test('non-uniform synthetic panorama round trip remains numerically meaningful', async () => {
  const w = 128;
  const h = 64;
  const gt = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      gt[i] = Math.round((255 * x) / (w - 1));
      gt[i + 1] = Math.round((255 * y) / (h - 1));
      gt[i + 2] = Math.round(127 + 127 * Math.sin((2 * Math.PI * x) / w) * Math.cos((Math.PI * y) / h));
      gt[i + 3] = 255;
    }
  }

  const dual = await generateDualFisheyeImageData({
    panoData: gt,
    panoW: w,
    panoH: h,
    yieldEveryRows: 0,
  });
  const reconstructed = await stitchImageData({
    srcData: dual.data,
    srcW: dual.width,
    srcH: dual.height,
    panoW: w,
    panoH: h,
    yieldEveryRows: 0,
  });

  const psnr = computePSNR(gt, reconstructed.data);
  assert.ok(psnr > 20, `Expected non-trivial round-trip PSNR, got ${psnr}`);
});

test('controlled right-lens photometric gain changes the synthetic capture', async () => {
  const w = 64, h = 32;
  const gt = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < gt.length; i += 4) {
    gt[i] = 100; gt[i + 1] = 100; gt[i + 2] = 100; gt[i + 3] = 255;
  }
  const neutral = await generateDualFisheyeImageData({ panoData: gt, panoW: w, panoH: h, yieldEveryRows: 0 });
  const shifted = await generateDualFisheyeImageData({
    panoData: gt, panoW: w, panoH: h, yieldEveryRows: 0,
    photometric: { right: { gain: 1.1 }, left: { gain: 1 } },
  });
  let difference = 0;
  for (let i = 0; i < neutral.data.length; i += 4) difference += Math.abs(neutral.data[i] - shifted.data[i]);
  assert.ok(difference > 0, 'Expected right-lens gain to modify synthetic pixels');
});
