import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLensBasis,
  directionToFisheye,
  equirectangularPixelToDirection,
} from '../docs/core/projection.js';
import { sampleBilinear } from '../docs/core/sampling.js';
import { featherWeight } from '../docs/core/blending.js';
import { stitchImageData } from '../docs/core/stitcher-core.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('feather weight equals one at lens axis and zero at FOV edge', () => {
  assert.ok(near(featherWeight(0, 1, 2), 1));
  assert.ok(near(featherWeight(1, 1, 2), 0));
  assert.ok(featherWeight(0.5, 1, 2) > featherWeight(0.75, 1, 2));
});

test('equirectangular center maps to +X in the legacy convention', () => {
  const v = equirectangularPixelToDirection(200, 100, 400, 200, 0);
  assert.ok(near(v[0], 1, 1e-12));
  assert.ok(near(v[1], 0, 1e-12));
  assert.ok(near(v[2], 0, 1e-12));
});

test('right optical axis maps to the fisheye center', () => {
  const basis = createLensBasis(true, 0, 0);
  const m = directionToFisheye([1, 0, 0], basis, 100, 100, 50, Math.PI / 2, 100);
  assert.ok(m);
  assert.ok(near(m.sx, 100));
  assert.ok(near(m.sy, 100));
  assert.ok(near(m.theta, 0));
});

test('bilinear sampling at an integer coordinate returns the source pixel', () => {
  const data = new Uint8ClampedArray([
    10, 20, 30, 255,   40, 50, 60, 255,
    70, 80, 90, 255,   100, 110, 120, 255,
  ]);
  assert.deepEqual(sampleBilinear(data, 2, 2, 0, 0), [10, 20, 30]);
});

test('stitch core is deterministic and returns opaque RGBA output', async () => {
  const w = 8;
  const h = 4;
  const src = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      src[i] = x * 20;
      src[i + 1] = y * 40;
      src[i + 2] = (x + y) * 10;
      src[i + 3] = 255;
    }
  }

  const a = await stitchImageData({ srcData: src, srcW: w, srcH: h, yieldEveryRows: 0 });
  const b = await stitchImageData({ srcData: src, srcW: w, srcH: h, yieldEveryRows: 0 });

  assert.equal(a.width, 8);
  assert.equal(a.height, 4);
  assert.deepEqual(a.data, b.data);

  for (let i = 3; i < a.data.length; i += 4) {
    assert.equal(a.data[i], 255);
  }
});
