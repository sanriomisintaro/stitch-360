/**
 * Sampling helpers for Stitch 360.
 */

/**
 * Bilinear RGB sampling from an RGBA Uint8ClampedArray.
 * The coordinate handling intentionally matches the original Stitch 360 code
 * so Sprint 1 remains a refactor rather than an algorithm change.
 */
export function sampleBilinear(data, width, height, x, y) {
  const x0 = Math.max(0, Math.min(width - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 2, Math.floor(y)));
  const tx = x - x0;
  const ty = y - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = i00 + 4;
  const i01 = i00 + width * 4;
  const i11 = i01 + 4;

  const r =
    data[i00] * (1 - tx) * (1 - ty) +
    data[i10] * tx * (1 - ty) +
    data[i01] * (1 - tx) * ty +
    data[i11] * tx * ty;

  const g =
    data[i00 + 1] * (1 - tx) * (1 - ty) +
    data[i10 + 1] * tx * (1 - ty) +
    data[i01 + 1] * (1 - tx) * ty +
    data[i11 + 1] * tx * ty;

  const b =
    data[i00 + 2] * (1 - tx) * (1 - ty) +
    data[i10 + 2] * tx * (1 - ty) +
    data[i01 + 2] * (1 - tx) * ty +
    data[i11 + 2] * tx * ty;

  return [r, g, b];
}

/**
 * Bilinear RGB sampling with horizontal wrapping, suitable for equirectangular
 * panoramas where longitude is periodic. Vertical coordinates are clamped.
 */
export function sampleBilinearWrappedX(data, width, height, x, y) {
  const wrapX = (value) => ((value % width) + width) % width;
  const clampedY = Math.max(0, Math.min(height - 1, y));

  const xBase = Math.floor(x);
  const yBase = Math.floor(clampedY);
  const x0 = wrapX(xBase);
  const x1 = wrapX(xBase + 1);
  const y0 = Math.max(0, Math.min(height - 1, yBase));
  const y1 = Math.max(0, Math.min(height - 1, yBase + 1));
  const tx = x - Math.floor(x);
  const ty = clampedY - yBase;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const channels = [0, 1, 2].map((c) =>
    data[i00 + c] * (1 - tx) * (1 - ty) +
    data[i10 + c] * tx * (1 - ty) +
    data[i01 + c] * (1 - tx) * ty +
    data[i11 + c] * tx * ty
  );

  return channels;
}
