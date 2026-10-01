import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFullReferenceMetrics,
  computeLumaSSIM,
  computeSeamMetrics,
} from '../docs/core/metrics.js';
import { parseGammaList, summarizeByGamma } from '../docs/core/experiment-utils.js';

function solid(w, h, value = 100) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = value; a[i + 1] = value; a[i + 2] = value; a[i + 3] = 255;
  }
  return a;
}

test('identical images have SSIM=1 and perfect full-reference metrics', () => {
  const w = 16, h = 16;
  const a = solid(w, h, 120);
  const m = computeFullReferenceMetrics(a, a, w, h);
  assert.equal(m.mse, 0);
  assert.equal(m.mae, 0);
  assert.equal(m.psnr, Infinity);
  assert.ok(Math.abs(m.ssim - 1) < 1e-12);
});

test('SSIM decreases after a visible perturbation', () => {
  const w = 16, h = 16;
  const a = solid(w, h, 120);
  const b = solid(w, h, 120);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
    const i = (y * w + x) * 4;
    b[i] = 220; b[i + 1] = 220; b[i + 2] = 220;
  }
  const s = computeLumaSSIM(a, b, w, h);
  assert.ok(s < 1 && s >= -1, `Unexpected SSIM ${s}`);
});

test('seam metrics react strongly to an error placed at the nominal seam', () => {
  const w = 72, h = 36;
  const ref = solid(w, h, 100);
  const cand = solid(w, h, 100);
  const seamX = Math.round(w / 4);
  for (let y = 0; y < h; y++) {
    for (let x = seamX - 1; x <= seamX + 1; x++) {
      const i = (y * w + x) * 4;
      cand[i] = 220; cand[i + 1] = 220; cand[i + 2] = 220;
    }
  }
  const seam = computeSeamMetrics(ref, cand, w, h, { seamHalfWidthDeg: 15 });
  assert.ok(seam.mae > 0);
  assert.ok(seam.ssim < 1);
  assert.ok(seam.gradientError > 0);
});

test('gamma parsing de-duplicates and sorts values', () => {
  assert.deepEqual(parseGammaList('2, 0.5, 1, 2; 4'), [0.5, 1, 2, 4]);
});

test('summary groups results by gamma', () => {
  const rows = [
    { gamma: 1, psnr: 30, ssim: .9, mae: 2, seamPsnr: 28, seamSsim: .8, seamMae: 3, seamGradientError: 4, runtimeMs: 100 },
    { gamma: 1, psnr: 32, ssim: .92, mae: 1, seamPsnr: 30, seamSsim: .82, seamMae: 2, seamGradientError: 3, runtimeMs: 120 },
    { gamma: 2, psnr: 31, ssim: .91, mae: 1.5, seamPsnr: 29, seamSsim: .81, seamMae: 2.5, seamGradientError: 3.5, runtimeMs: 110 },
  ];
  const s = summarizeByGamma(rows);
  assert.equal(s.length, 2);
  assert.equal(s[0].gamma, 1);
  assert.equal(s[0].n, 2);
  assert.equal(s[0].psnrMean, 31);
});
