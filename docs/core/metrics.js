/**
 * Reproducible full-reference metrics for Stitch 360 research experiments.
 *
 * Implemented without external dependencies so the browser experiment and the
 * automated tests use the same code path.
 *
 * SSIM definition used here:
 *   - luminance-only (Rec. 709 RGB -> Y)
 *   - 7x7 uniform local window
 *   - valid-window centers only (no padded borders)
 *   - sample variance/covariance (N-1 denominator)
 *   - K1=0.01, K2=0.03, L=255
 *
 * This exact definition should be reported if browser-generated SSIM values are
 * used in a manuscript. A later offline analysis can independently reproduce
 * it with the same settings.
 */

function validatePair(reference, candidate) {
  if (!(reference instanceof Uint8ClampedArray) || !(candidate instanceof Uint8ClampedArray)) {
    throw new TypeError('reference and candidate must be Uint8ClampedArray values');
  }
  if (reference.length !== candidate.length || reference.length % 4 !== 0) {
    throw new RangeError('RGBA buffers must have equal lengths');
  }
}

function validateDimensions(buffer, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('width and height must be positive integers');
  }
  if (buffer.length !== width * height * 4) {
    throw new RangeError('RGBA buffer length does not match width × height × 4');
  }
}

export function rgbToLumaArray(rgba) {
  if (!(rgba instanceof Uint8ClampedArray) || rgba.length % 4 !== 0) {
    throw new TypeError('rgba must be an RGBA Uint8ClampedArray');
  }
  const out = new Float64Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    out[p] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return out;
}

export function computeRgbMSE(reference, candidate) {
  validatePair(reference, candidate);
  let squaredError = 0;
  let n = 0;
  for (let i = 0; i < reference.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = reference[i + c] - candidate[i + c];
      squaredError += diff * diff;
      n += 1;
    }
  }
  return squaredError / n;
}

export function computeRgbMAE(reference, candidate) {
  validatePair(reference, candidate);
  let absoluteError = 0;
  let n = 0;
  for (let i = 0; i < reference.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      absoluteError += Math.abs(reference[i + c] - candidate[i + c]);
      n += 1;
    }
  }
  return absoluteError / n;
}

export function computePSNR(reference, candidate, peak = 255) {
  const mse = computeRgbMSE(reference, candidate);
  if (mse === 0) return Infinity;
  return 10 * Math.log10((peak * peak) / mse);
}

function buildIntegral(values, width, height) {
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += values[(y - 1) * width + (x - 1)];
      integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
    }
  }
  return integral;
}

function rectSum(integral, width, x0, y0, x1, y1) {
  const stride = width + 1;
  const a = integral[y0 * stride + x0];
  const b = integral[y0 * stride + x1];
  const c = integral[y1 * stride + x0];
  const d = integral[y1 * stride + x1];
  return d - b - c + a;
}

/**
 * Mean local SSIM on luminance. regionPredicate, when provided, is evaluated
 * at each local-window center and can restrict the aggregate (e.g. seam bands).
 */
export function computeLumaSSIM(
  reference,
  candidate,
  width,
  height,
  {
    windowSize = 7,
    k1 = 0.01,
    k2 = 0.03,
    peak = 255,
    regionPredicate = null,
  } = {}
) {
  validatePair(reference, candidate);
  validateDimensions(reference, width, height);
  if (!Number.isInteger(windowSize) || windowSize < 3 || windowSize % 2 === 0) {
    throw new RangeError('windowSize must be an odd integer >= 3');
  }
  if (width < windowSize || height < windowSize) {
    throw new RangeError('Image is smaller than the SSIM window');
  }

  const x = rgbToLumaArray(reference);
  const y = rgbToLumaArray(candidate);
  const x2 = new Float64Array(x.length);
  const y2 = new Float64Array(y.length);
  const xy = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    x2[i] = x[i] * x[i];
    y2[i] = y[i] * y[i];
    xy[i] = x[i] * y[i];
  }

  const ix = buildIntegral(x, width, height);
  const iy = buildIntegral(y, width, height);
  const ix2 = buildIntegral(x2, width, height);
  const iy2 = buildIntegral(y2, width, height);
  const ixy = buildIntegral(xy, width, height);

  const half = Math.floor(windowSize / 2);
  const n = windowSize * windowSize;
  const c1 = (k1 * peak) ** 2;
  const c2 = (k2 * peak) ** 2;
  let sumSsim = 0;
  let count = 0;

  for (let cy = half; cy < height - half; cy++) {
    const y0 = cy - half;
    const y1 = cy + half + 1;
    for (let cx = half; cx < width - half; cx++) {
      if (regionPredicate && !regionPredicate(cx, cy)) continue;
      const x0 = cx - half;
      const x1 = cx + half + 1;

      const sx = rectSum(ix, width, x0, y0, x1, y1);
      const sy = rectSum(iy, width, x0, y0, x1, y1);
      const sx2 = rectSum(ix2, width, x0, y0, x1, y1);
      const sy2 = rectSum(iy2, width, x0, y0, x1, y1);
      const sxy = rectSum(ixy, width, x0, y0, x1, y1);

      const mux = sx / n;
      const muy = sy / n;
      const varx = Math.max(0, (sx2 - (sx * sx) / n) / (n - 1));
      const vary = Math.max(0, (sy2 - (sy * sy) / n) / (n - 1));
      const cov = (sxy - (sx * sy) / n) / (n - 1);

      const numerator = (2 * mux * muy + c1) * (2 * cov + c2);
      const denominator = (mux * mux + muy * muy + c1) * (varx + vary + c2);
      sumSsim += denominator === 0 ? 1 : numerator / denominator;
      count++;
    }
  }

  return count > 0 ? sumSsim / count : NaN;
}

export function createSeamRegionPredicate(width, seamHalfWidthDeg = 10) {
  if (!Number.isFinite(seamHalfWidthDeg) || seamHalfWidthDeg <= 0 || seamHalfWidthDeg >= 90) {
    throw new RangeError('seamHalfWidthDeg must be > 0 and < 90');
  }
  const halfWidthPx = (width * seamHalfWidthDeg) / 360;
  const centers = [width * 0.25, width * 0.75];
  return (x) => centers.some((center) => Math.abs(x - center) <= halfWidthPx);
}

function computeRegionRgbErrors(reference, candidate, width, height, predicate) {
  validatePair(reference, candidate);
  validateDimensions(reference, width, height);
  let sq = 0;
  let abs = 0;
  let n = 0;
  let pixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!predicate(x, y)) continue;
      const i = (y * width + x) * 4;
      pixels++;
      for (let c = 0; c < 3; c++) {
        const d = reference[i + c] - candidate[i + c];
        sq += d * d;
        abs += Math.abs(d);
        n++;
      }
    }
  }
  const mse = n > 0 ? sq / n : NaN;
  const mae = n > 0 ? abs / n : NaN;
  return { mse, mae, pixels };
}

/**
 * Ground-truth-aware seam metrics around the two nominal crossover meridians
 * (longitude -90° and +90° for the default opposed-lens geometry).
 */
export function computeSeamMetrics(
  reference,
  candidate,
  width,
  height,
  { seamHalfWidthDeg = 10, ssimWindowSize = 7 } = {}
) {
  const predicate = createSeamRegionPredicate(width, seamHalfWidthDeg);
  const { mse, mae, pixels } = computeRegionRgbErrors(
    reference,
    candidate,
    width,
    height,
    predicate
  );
  const psnr = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
  const ssim = computeLumaSSIM(reference, candidate, width, height, {
    windowSize: ssimWindowSize,
    regionPredicate: predicate,
  });

  const refY = rgbToLumaArray(reference);
  const candY = rgbToLumaArray(candidate);
  let gradError = 0;
  let gradCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      if (!predicate(x, y)) continue;
      const i = y * width + x;
      const refGrad = refY[i + 1] - refY[i];
      const candGrad = candY[i + 1] - candY[i];
      gradError += Math.abs(refGrad - candGrad);
      gradCount++;
    }
  }

  return {
    mse,
    psnr,
    mae,
    ssim,
    gradientError: gradCount > 0 ? gradError / gradCount : NaN,
    pixels,
    seamHalfWidthDeg,
  };
}

export function computeFullReferenceMetrics(reference, candidate, width, height) {
  return {
    mse: computeRgbMSE(reference, candidate),
    mae: computeRgbMAE(reference, candidate),
    psnr: computePSNR(reference, candidate),
    ssim: computeLumaSSIM(reference, candidate, width, height),
  };
}
