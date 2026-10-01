import {
  createLensBasis,
  degToRad,
  directionToFisheye,
  directionToFisheyeFallback,
  equirectangularPixelToDirection,
} from './projection.js';
import { sampleBilinear } from './sampling.js';
import { blendWeighted, featherWeight } from './blending.js';

export const DEFAULT_CONFIG = Object.freeze({
  scale: 1.0,
  fovDeg: 185.0,
  radiusScale: 0.965,
  centers: Object.freeze({
    left: Object.freeze([0.25, 0.50]),
    right: Object.freeze([0.75, 0.50]),
  }),
  rollDeg: Object.freeze({ left: 0.0, right: 0.5 }),
  yawBiasDeg: Object.freeze({ left: 0.0, right: 0.0 }),
  globalYawDeg: 0.0,
  blend: Object.freeze({ enable: true, gamma: 2.0 }),
});

export function createConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    centers: {
      ...DEFAULT_CONFIG.centers,
      ...(overrides.centers || {}),
    },
    rollDeg: {
      ...DEFAULT_CONFIG.rollDeg,
      ...(overrides.rollDeg || {}),
    },
    yawBiasDeg: {
      ...DEFAULT_CONFIG.yawBiasDeg,
      ...(overrides.yawBiasDeg || {}),
    },
    blend: {
      ...DEFAULT_CONFIG.blend,
      ...(overrides.blend || {}),
    },
  };
}

/**
 * Stitch raw RGBA source data into an equirectangular RGBA buffer.
 *
 * This function is intentionally DOM-free so the same algorithm can be used
 * by the browser UI, automated tests, and future benchmark scripts.
 */
export async function stitchImageData({
  srcData,
  srcW,
  srcH,
  panoW = null,
  panoH = null,
  config = {},
  yieldEveryRows = 32,
  yieldControl = async () => {},
  onProgress = null,
}) {
  if (!(srcData instanceof Uint8ClampedArray)) {
    throw new TypeError('srcData must be a Uint8ClampedArray');
  }
  if (!Number.isInteger(srcW) || !Number.isInteger(srcH) || srcW < 2 || srcH < 2) {
    throw new RangeError('srcW and srcH must be integers >= 2');
  }
  if (srcData.length !== srcW * srcH * 4) {
    throw new RangeError('srcData length does not match srcW × srcH × 4');
  }

  const cfg = createConfig(config);
  const outW = panoW ?? Math.round(srcW * cfg.scale);
  const outH = panoH ?? Math.round(outW / 2);

  if (!Number.isInteger(outW) || !Number.isInteger(outH) || outW < 1 || outH < 1) {
    throw new RangeError('Output dimensions must be positive integers');
  }

  const output = new Uint8ClampedArray(outW * outH * 4);

  const cxL = srcW * cfg.centers.left[0];
  const cxR = srcW * cfg.centers.right[0];
  const cyL = srcH * cfg.centers.left[1];
  const cyR = srcH * cfg.centers.right[1];
  const radius = Math.min(srcW * 0.25, srcH * 0.5) * cfg.radiusScale;

  const fovRad = degToRad(cfg.fovDeg);
  const halfFov = fovRad / 2;
  const f = radius / halfFov;

  const rightBasis = createLensBasis(
    true,
    cfg.rollDeg.right,
    cfg.yawBiasDeg.right
  );
  const leftBasis = createLensBasis(
    false,
    cfg.rollDeg.left,
    cfg.yawBiasDeg.left
  );

  for (let py = 0; py < outH; py++) {
    for (let px = 0; px < outW; px++) {
      const direction = equirectangularPixelToDirection(
        px,
        py,
        outW,
        outH,
        cfg.globalYawDeg
      );

      const rightMap = directionToFisheye(
        direction,
        rightBasis,
        cxR,
        cyR,
        f,
        halfFov,
        radius
      );
      const leftMap = directionToFisheye(
        direction,
        leftBasis,
        cxL,
        cyL,
        f,
        halfFov,
        radius
      );

      const samples = [];

      if (rightMap) {
        samples.push({
          color: sampleBilinear(srcData, srcW, srcH, rightMap.sx, rightMap.sy),
          weight: featherWeight(rightMap.theta, halfFov, cfg.blend.gamma),
        });
      }

      if (leftMap) {
        samples.push({
          color: sampleBilinear(srcData, srcW, srcH, leftMap.sx, leftMap.sy),
          weight: featherWeight(leftMap.theta, halfFov, cfg.blend.gamma),
        });
      }

      let color = blendWeighted(samples);

      // Preserve the original fallback behavior for Sprint 1 equivalence.
      if (!color) {
        const useRight = direction[0] >= 0;
        const basis = useRight ? rightBasis : leftBasis;
        const cx = useRight ? cxR : cxL;
        const cy = useRight ? cyR : cyL;
        const fallback = directionToFisheyeFallback(direction, basis, cx, cy, f);
        color = sampleBilinear(srcData, srcW, srcH, fallback.sx, fallback.sy);
      }

      const di = (py * outW + px) * 4;
      output[di] = color[0];
      output[di + 1] = color[1];
      output[di + 2] = color[2];
      output[di + 3] = 255;
    }

    if (typeof onProgress === 'function') {
      onProgress((py + 1) / outH);
    }

    if (yieldEveryRows > 0 && (py & (yieldEveryRows - 1)) === 0) {
      await yieldControl();
    }
  }

  return {
    data: output,
    width: outW,
    height: outH,
    config: cfg,
  };
}
