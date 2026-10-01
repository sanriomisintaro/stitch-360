/**
 * Pure projection helpers for Stitch 360.
 * Sprint 1 goal: preserve the geometry used by the original docs/stitcher.js.
 */

export const PI = Math.PI;

export function degToRad(deg) {
  return (deg * PI) / 180.0;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Convert an equirectangular output pixel into the unit direction used by
 * the legacy Stitch 360 implementation.
 */
export function equirectangularPixelToDirection(
  px,
  py,
  panoW,
  panoH,
  globalYawDeg = 0
) {
  const lat = (py / panoH) * PI - PI / 2;
  const lon = (px / panoW) * 2 * PI - PI + degToRad(globalYawDeg);

  const cosLat = Math.cos(lat);
  return [
    cosLat * Math.cos(lon),
    cosLat * Math.sin(lon),
    Math.sin(lat),
  ];
}

/** Rodrigues rotation around an arbitrary axis. */
export function rotateAroundAxis(v, axis, angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const [ax, ay, az] = axis;
  const dot = v[0] * ax + v[1] * ay + v[2] * az;

  return [
    v[0] * c + s * (ay * v[2] - az * v[1]) + (1 - c) * ax * dot,
    v[1] * c + s * (az * v[0] - ax * v[2]) + (1 - c) * ay * dot,
    v[2] * c + s * (ax * v[1] - ay * v[0]) + (1 - c) * az * dot,
  ];
}

/**
 * Build the same lens basis used by the original implementation.
 * This intentionally preserves the original yaw/roll convention.
 */
export function createLensBasis(isRight, rollDeg = 0, yawBiasDeg = 0) {
  const axis = isRight ? [1, 0, 0] : [-1, 0, 0];
  let up = [0, 0, 1];
  let right = isRight ? [0, 1, 0] : [0, -1, 0];

  const yawBias = degToRad(yawBiasDeg);
  if (yawBias !== 0) {
    const c = Math.cos(yawBias);
    const s = Math.sin(yawBias);
    const rotZ = (vec) => [
      vec[0] * c - vec[1] * s,
      vec[0] * s + vec[1] * c,
      vec[2],
    ];
    up = rotZ(up);
    right = rotZ(right);
  }

  const roll = degToRad(rollDeg);
  if (roll !== 0) {
    up = rotateAroundAxis(up, axis, roll);
    right = rotateAroundAxis(right, axis, roll);
  }

  return { axis, up, right };
}

/**
 * Project a world-space unit direction into an equidistant fisheye image.
 * Returns null when the direction is outside the configured FOV or lens circle.
 */
export function directionToFisheye(
  direction,
  basis,
  cx,
  cy,
  f,
  halfFov,
  radius
) {
  const dotAxis =
    direction[0] * basis.axis[0] +
    direction[1] * basis.axis[1] +
    direction[2] * basis.axis[2];

  const theta = Math.acos(clamp(dotAxis, -1, 1));
  if (theta > halfFov) return null;

  const vu =
    direction[0] * basis.up[0] +
    direction[1] * basis.up[1] +
    direction[2] * basis.up[2];
  const vr =
    direction[0] * basis.right[0] +
    direction[1] * basis.right[1] +
    direction[2] * basis.right[2];

  const azimuth = Math.atan2(vr, vu);
  const distance = f * theta;
  const sx = cx + distance * Math.sin(azimuth);
  const sy = cy - distance * Math.cos(azimuth);

  const dx = sx - cx;
  const dy = sy - cy;
  if (dx * dx + dy * dy > radius * radius) return null;

  return { sx, sy, theta };
}

/**
 * Legacy fallback projection used when a panorama direction is rejected by
 * both lens-circle checks. This is kept separate so later research versions
 * can replace it without changing the validated Sprint 1 core.
 */
export function directionToFisheyeFallback(direction, basis, cx, cy, f) {
  const vu =
    direction[0] * basis.up[0] +
    direction[1] * basis.up[1] +
    direction[2] * basis.up[2];
  const vr =
    direction[0] * basis.right[0] +
    direction[1] * basis.right[1] +
    direction[2] * basis.right[2];
  const dotAxis =
    direction[0] * basis.axis[0] +
    direction[1] * basis.axis[1] +
    direction[2] * basis.axis[2];

  const theta = Math.acos(clamp(dotAxis, -1, 1));
  const azimuth = Math.atan2(vr, vu);
  const distance = f * theta;

  return {
    sx: cx + distance * Math.sin(azimuth),
    sy: cy - distance * Math.cos(azimuth),
    theta,
  };
}

/**
 * Convert a world-space unit direction into floating-point equirectangular
 * pixel coordinates using the same convention as equirectangularPixelToDirection.
 * Horizontal coordinates are returned in [0, panoW); vertical coordinates are
 * clamped to [0, panoH - 1].
 */
export function directionToEquirectangularPixel(
  direction,
  panoW,
  panoH,
  globalYawDeg = 0
) {
  const [x, y, z] = direction;
  const lat = Math.asin(clamp(z, -1, 1));
  let lon = Math.atan2(y, x) - degToRad(globalYawDeg);

  // Wrap longitude to [-PI, PI).
  lon = ((lon + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;

  let px = ((lon + PI) / (2 * PI)) * panoW;
  if (px >= panoW) px -= panoW;
  if (px < 0) px += panoW;

  const py = clamp(((lat + PI / 2) / PI) * panoH, 0, panoH - 1);
  return { x: px, y: py };
}

/**
 * Inverse of directionToFisheye for an equidistant lens model.
 * Maps a source fisheye pixel back to a world-space unit direction.
 */
export function fisheyePixelToDirection(
  sx,
  sy,
  basis,
  cx,
  cy,
  f,
  halfFov,
  radius
) {
  const dx = sx - cx;
  const dy = sy - cy;
  const r = Math.hypot(dx, dy);
  if (r > radius) return null;

  const theta = r / f;
  if (theta > halfFov) return null;

  if (r === 0) return [...basis.axis];

  const azimuth = Math.atan2(dx, -dy);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const upScale = sinTheta * Math.cos(azimuth);
  const rightScale = sinTheta * Math.sin(azimuth);

  return [
    basis.axis[0] * cosTheta + basis.up[0] * upScale + basis.right[0] * rightScale,
    basis.axis[1] * cosTheta + basis.up[1] * upScale + basis.right[1] * rightScale,
    basis.axis[2] * cosTheta + basis.up[2] * upScale + basis.right[2] * rightScale,
  ];
}
