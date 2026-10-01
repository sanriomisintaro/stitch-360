/**
 * Synthetic dual-fisheye generator for Stitch 360 research experiments.
 *
 * Purpose:
 *   Ground-truth equirectangular panorama -> synthetic dual-fisheye frame.
 *
 * The generator intentionally uses the same lens conventions and equidistant
 * model as stitcher-core.js so controlled round-trip experiments can isolate
 * reconstruction/blending behaviour from unknown camera calibration effects.
 */

import {
  createLensBasis,
  degToRad,
  directionToEquirectangularPixel,
  fisheyePixelToDirection,
} from './projection.js';
import { sampleBilinearWrappedX } from './sampling.js';
import { createConfig } from './stitcher-core.js';

/**
 * Generate a side-by-side dual-fisheye RGBA frame from a 2:1 equirectangular
 * panorama buffer.
 *
 * By default, the synthetic frame uses the same dimensions as the panorama,
 * matching the layout expected by Stitch 360 (two circles side-by-side).
 */
export async function generateDualFisheyeImageData({
  panoData,
  panoW,
  panoH,
  srcW = null,
  srcH = null,
  config = {},
  background = [0, 0, 0, 255],
  photometric = null,
  yieldEveryRows = 32,
  yieldControl = async () => {},
  onProgress = null,
}) {
  if (!(panoData instanceof Uint8ClampedArray)) {
    throw new TypeError('panoData must be a Uint8ClampedArray');
  }
  if (!Number.isInteger(panoW) || !Number.isInteger(panoH) || panoW < 2 || panoH < 2) {
    throw new RangeError('panoW and panoH must be integers >= 2');
  }
  if (panoData.length !== panoW * panoH * 4) {
    throw new RangeError('panoData length does not match panoW × panoH × 4');
  }

  const cfg = createConfig(config);
  const outW = srcW ?? panoW;
  const outH = srcH ?? panoH;

  if (!Number.isInteger(outW) || !Number.isInteger(outH) || outW < 2 || outH < 2) {
    throw new RangeError('Synthetic source dimensions must be integers >= 2');
  }

  const output = new Uint8ClampedArray(outW * outH * 4);
  const [bgR, bgG, bgB, bgA = 255] = background;
  for (let i = 0; i < output.length; i += 4) {
    output[i] = bgR;
    output[i + 1] = bgG;
    output[i + 2] = bgB;
    output[i + 3] = bgA;
  }

  const cxL = outW * cfg.centers.left[0];
  const cxR = outW * cfg.centers.right[0];
  const cyL = outH * cfg.centers.left[1];
  const cyR = outH * cfg.centers.right[1];
  const radius = Math.min(outW * 0.25, outH * 0.5) * cfg.radiusScale;

  const halfFov = degToRad(cfg.fovDeg) / 2;
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

  for (let sy = 0; sy < outH; sy++) {
    for (let sx = 0; sx < outW; sx++) {
      const dLx = sx - cxL;
      const dLy = sy - cyL;
      const dRx = sx - cxR;
      const dRy = sy - cyR;
      const inLeft = dLx * dLx + dLy * dLy <= radius * radius;
      const inRight = dRx * dRx + dRy * dRy <= radius * radius;

      if (!inLeft && !inRight) continue;

      // The two synthetic circles normally do not overlap. If custom geometry
      // creates an overlap, use the closer lens center deterministically.
      const useRight = inRight && (!inLeft || dRx * dRx + dRy * dRy <= dLx * dLx + dLy * dLy);
      const basis = useRight ? rightBasis : leftBasis;
      const cx = useRight ? cxR : cxL;
      const cy = useRight ? cyR : cyL;

      const direction = fisheyePixelToDirection(
        sx,
        sy,
        basis,
        cx,
        cy,
        f,
        halfFov,
        radius
      );
      if (!direction) continue;

      const eq = directionToEquirectangularPixel(
        direction,
        panoW,
        panoH,
        cfg.globalYawDeg
      );

      const color = sampleBilinearWrappedX(
        panoData,
        panoW,
        panoH,
        eq.x,
        eq.y
      );

      // Optional controlled photometric perturbation for research experiments.
      // This is applied at synthetic capture time only, allowing the reconstruction
      // pipeline to be evaluated under known inter-lens exposure/color mismatch.
      const lensPhoto = useRight ? photometric?.right : photometric?.left;
      const gain = Array.isArray(lensPhoto?.gain) ? lensPhoto.gain : [lensPhoto?.gain ?? 1, lensPhoto?.gain ?? 1, lensPhoto?.gain ?? 1];
      const offset = Array.isArray(lensPhoto?.offset) ? lensPhoto.offset : [lensPhoto?.offset ?? 0, lensPhoto?.offset ?? 0, lensPhoto?.offset ?? 0];
      const corrected = color.map((v, c) => Math.max(0, Math.min(255, v * gain[c] + offset[c])));

      const di = (sy * outW + sx) * 4;
      output[di] = corrected[0];
      output[di + 1] = corrected[1];
      output[di + 2] = corrected[2];
      output[di + 3] = 255;
    }

    if (typeof onProgress === 'function') {
      onProgress((sy + 1) / outH);
    }
    if (yieldEveryRows > 0 && sy % yieldEveryRows === 0) {
      await yieldControl();
    }
  }

  return {
    data: output,
    width: outW,
    height: outH,
    config: cfg,
    geometry: {
      radius,
      focalScale: f,
      halfFov,
      centers: {
        left: [cxL, cyL],
        right: [cxR, cyR],
      },
    },
  };
}
