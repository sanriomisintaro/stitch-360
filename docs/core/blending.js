/**
 * Blending helpers for Stitch 360.
 */

export function featherWeight(theta, halfFov, gamma = 2.0) {
  let w = 1.0 - theta / halfFov;
  if (w < 0) w = 0;
  return Math.pow(w, gamma);
}

/**
 * Normalize and combine weighted RGB samples.
 * samples: [{ color: [r,g,b], weight: number }, ...]
 */
export function blendWeighted(samples) {
  let r = 0;
  let g = 0;
  let b = 0;
  let weightSum = 0;

  for (const sample of samples) {
    if (!sample || sample.weight <= 0) continue;
    r += sample.color[0] * sample.weight;
    g += sample.color[1] * sample.weight;
    b += sample.color[2] * sample.weight;
    weightSum += sample.weight;
  }

  if (weightSum <= 0) return null;
  return [r / weightSum, g / weightSum, b / weightSum];
}
