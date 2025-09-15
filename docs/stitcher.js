/**
 * Stitch 360: client-side dual-fisheye -> equirectangular stitcher.
 * Repo: https://github.com/sanriomisintaro/stitch-360
 * About: Convert dual-fisheye images to equirectangular panoramas.
 *
 * Model & blending:
 *  - Projection: equidistant fisheye  r = f * θ
 *  - Overlap feather: w = max(0, 1 − θ/(FOV/2))^γ
 *
 * Implementation notes:
 *  - HTML Canvas + JavaScript only (no deps).
 *  - Long loops yield via requestAnimationFrame to keep the UI responsive.
 *  - Export supports PNG (lossless) and JPEG (quality + optional downscale).
 *
 * Conventions:
 *  - Angles are in radians unless explicitly stated (e.g., cfg fields are in degrees).
 *  - Image coordinates (sx, sy) are pixel-space with (0,0) at top-left.
 */

//// DOM references
const imageLoader     = document.getElementById('imageLoader');
const sourceCanvas    = document.getElementById('sourceCanvas');
const panoramaCanvas  = document.getElementById('panoramaCanvas');
const sourceCtx       = sourceCanvas.getContext('2d', { willReadFrequently: true });
const panoCtx         = panoramaCanvas.getContext('2d', { willReadFrequently: true });
const loaderEl        = document.getElementById('loader');
const actionsEl       = document.getElementById('actions');
const downloadBtn     = document.getElementById('downloadBtn');
const downloadJpgBtn  = document.getElementById('downloadJpgBtn');
const jpgQuality      = document.getElementById('jpgQuality');
const jpgQualityVal   = document.getElementById('jpgQualityVal');
const jpgScale        = document.getElementById('jpgScale');

let lastBaseName = 'panorama';

/**
 * UI: show/hide the full-screen loader overlay.
 * @param {boolean} isOn
 */
function setLoading(isOn) {
  if (loaderEl) loaderEl.classList.toggle('hidden', !isOn);
}

/**
 * UI: show/hide the post-stitch action buttons area.
 * @param {boolean} isOn
 */
function setActionsVisible(isOn) {
  if (actionsEl) actionsEl.classList.toggle('hidden', !isOn);
}

/**
 * @typedef {Object} Config
 * @property {number} scale          Output width scale relative to input width (H = W/2).
 * @property {number} fovDeg         Per-lens fisheye field of view in degrees.
 * @property {number} radiusScale    Fraction of the ideal lens circle radius to accept.
 * @property {{left:number[],right:number[]}} centers  Normalized lens centers [x/W, y/H].
 * @property {{left:number,right:number}} rollDeg      Clockwise roll per lens (deg).
 * @property {{left:number,right:number}} yawBiasDeg   Additional yaw per lens (deg).
 * @property {number} globalYawDeg   Horizontal rotation of the panorama (deg).
 * @property {{enable:boolean,gamma:number}} blend     Feathering control.
 * @property {boolean} logOnce       Guard to log parameters only once.
 */

/** @type {Config} */
const cfg = {
  scale: 1.0,
  fovDeg: 200.0,            // Use 198–205 for wider overlap if seams appear.
  radiusScale: 0.985,
  centers: { left: [0.25, 0.50], right: [0.75, 0.50] },
  rollDeg: { left: 0.0, right: 0.0 },
  yawBiasDeg: { left: 0.0, right: 0.0 },
  globalYawDeg: 0.0,
  blend: { enable: true, gamma: 2.0 },
  logOnce: true,
};

imageLoader.addEventListener('change', onFile, false);
if (downloadBtn)    downloadBtn.addEventListener('click', onDownloadPng, false);
if (downloadJpgBtn) downloadJpgBtn.addEventListener('click', onDownloadJpg, false);
if (jpgQuality && jpgQualityVal) {
  const updateQ = () => (jpgQualityVal.textContent = `${Math.round(parseFloat(jpgQuality.value) * 100)}%`);
  jpgQuality.addEventListener('input', updateQ, false);
  updateQ();
}

/**
 * Handle file input: load image -> render source -> stitch -> reveal actions.
 */
async function onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  setActionsVisible(false);
  lastBaseName = (file.name || 'panorama').replace(/\.[^.]+$/, '');

  try {
    setLoading(true);

    const img = await loadImageFromFile(file);

    // Draw source
    sourceCanvas.width = img.width;
    sourceCanvas.height = img.height;
    sourceCtx.drawImage(img, 0, 0);

    // Set panorama dimensions (H = W/2)
    const panoW = Math.round(img.width * cfg.scale);
    const panoH = Math.round(panoW / 2);
    panoramaCanvas.width = panoW;
    panoramaCanvas.height = panoH;

    // Allow the loader to paint before the heavy loop.
    await new Promise(requestAnimationFrame);

    await stitch(img.width, img.height, panoW, panoH);
    setActionsVisible(true);
  } catch (err) {
    console.error(err);
    alert('Stitching failed: ' + (err?.message || err));
  } finally {
    setLoading(false);
  }
}

/**
 * Read an image File/Blob into an HTMLImageElement (data URL).
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Export the panorama canvas to a Blob.
 * Respects a 180° CSS rotate (so the saved image matches the on-screen view),
 * and can optionally downscale and/or encode as JPEG with a solid background.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{mime?:'image/png'|'image/jpeg',quality?:number,scale?:number}} [opts]
 * @returns {Promise<Blob>}
 */
function exportCanvas(canvas, { mime = 'image/png', quality = 0.92, scale = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const transform = (canvas.style.transform || '').replace(/\s/g, '');
    const m = /rotate\(([-\d.]+)deg\)/.exec(transform);
    const needs180 = m && Math.abs(parseFloat(m[1]) % 360) === 180;

    const needsOffscreen = needs180 || scale !== 1 || mime === 'image/jpeg';
    if (needsOffscreen) {
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.round(canvas.width * scale));
      off.height = Math.max(1, Math.round(canvas.height * scale));
      const ctx = off.getContext('2d');

      // JPEG has no alpha; fill white to avoid black/transparent areas.
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, off.width, off.height);
      }

      if (needs180) {
        ctx.translate(off.width / 2, off.height / 2);
        ctx.rotate(Math.PI);
        ctx.drawImage(canvas, -off.width / 2, -off.height / 2, off.width, off.height);
      } else {
        ctx.drawImage(canvas, 0, 0, off.width, off.height);
      }

      off.toBlob(b => (b ? resolve(b) : reject(new Error('Export failed'))), mime, quality);
    } else {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Export failed'))), mime, quality);
    }
  });
}

/** Download helpers (PNG and JPEG) */
async function onDownloadPng() {
  try {
    downloadBtn.disabled = true;
    if (downloadJpgBtn) downloadJpgBtn.disabled = true;
    const blob = await exportCanvas(panoramaCanvas, { mime: 'image/png', quality: 0.92, scale: 1 });
    triggerDownload(blob, `${lastBaseName}-stitched.png`);
  } catch (err) {
    console.error(err);
    alert('Download failed: ' + (err?.message || err));
  } finally {
    downloadBtn.disabled = false;
    if (downloadJpgBtn) downloadJpgBtn.disabled = false;
  }
}

async function onDownloadJpg() {
  try {
    if (downloadBtn) downloadBtn.disabled = true;
    downloadJpgBtn.disabled = true;
    const q = jpgQuality ? parseFloat(jpgQuality.value) : 0.85;
    const s = jpgScale ? parseFloat(jpgScale.value) : 1;
    const blob = await exportCanvas(panoramaCanvas, { mime: 'image/jpeg', quality: q, scale: s });
    const suffix = s === 1 ? '' : `-${Math.round(s * 100)}pct`;
    triggerDownload(blob, `${lastBaseName}-stitched${suffix}.jpg`);
  } catch (err) {
    console.error(err);
    alert('Download failed: ' + (err?.message || err));
  } finally {
    if (downloadBtn) downloadBtn.disabled = false;
    downloadJpgBtn.disabled = false;
  }
}

/**
 * Trigger a file download from a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Core stitcher: maps each panorama pixel to one or both fisheye images and blends.
 *
 * Geometry overview (per output pixel):
 *  1) Convert (px, py) -> lon/lat (λ, φ) -> unit vector v = (vx, vy, vz).
 *  2) For each lens, compute angle θ to lens axis; reject if θ > FOV/2.
 *  3) Equidistant projection: r = f * θ where f = radius / (FOV/2).
 *  4) Azimuth α around lens axis gives source sample (sx, sy) in pixel space.
 *  5) Bilinear sample; feather-blend overlapping contributions.
 *
 * @param {number} srcW Source image width (pixels)
 * @param {number} srcH Source image height (pixels)
 * @param {number} panoW Panorama width (pixels)
 * @param {number} panoH Panorama height (pixels)
 */
async function stitch(srcW, srcH, panoW, panoH) {
  if (cfg.logOnce) {
    console.log('Stitch params:', JSON.stringify(cfg, null, 2));
    cfg.logOnce = false;
  }

  const src = sourceCtx.getImageData(0, 0, srcW, srcH);
  const S = src.data;

  const out = panoCtx.createImageData(panoW, panoH);
  const D = out.data;

  // Lens centers & radius
  const cxL = srcW * cfg.centers.left[0];
  const cxR = srcW * cfg.centers.right[0];
  const cyL = srcH * cfg.centers.left[1];
  const cyR = srcH * cfg.centers.right[1];
  const radius = Math.min(srcW * 0.25, srcH * 0.5) * cfg.radiusScale;

  // Fisheye model constants
  const fovRad  = (cfg.fovDeg * Math.PI) / 180.0;
  const halfFov = fovRad / 2;
  const f       = radius / halfFov; // equidistant

  // Base directions (world: Z up, Y right for convenience)
  const AXIS_R = [ 1, 0, 0 ];
  const AXIS_L = [ -1, 0, 0 ];
  const UP     = [ 0, 0, 1 ];
  const RIGHT  = [ 0, 1, 0 ];

  /** Rodrigues rotation around an axis by angle ang. */
  function rotateAroundAxis(v, axis, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const [ax, ay, az] = axis;
    const dot = v[0]*ax + v[1]*ay + v[2]*az;
    return [
      v[0]*c + s*(ay*v[2] - az*v[1]) + (1 - c)*ax*dot,
      v[1]*c + s*(az*v[0] - ax*v[2]) + (1 - c)*ay*dot,
      v[2]*c + s*(ax*v[1] - ay*v[0]) + (1 - c)*az*dot,
    ];
  }

  /** Build lens basis (axis, up, right) with per-lens yaw bias and roll. */
  function lensBasis(isRight) {
    const AXIS = isRight ? AXIS_R : AXIS_L;
    let up = [...UP];
    let right = isRight ? [...RIGHT] : [0, -1, 0]; // ensure azimuth grows consistently

    // Yaw bias (deg -> rad) applied in world Z before roll
    const yawBias = ((isRight ? cfg.yawBiasDeg.right : cfg.yawBiasDeg.left) * Math.PI) / 180.0;
    if (yawBias !== 0) {
      const c = Math.cos(yawBias), s = Math.sin(yawBias);
      const rotZ = (vec) => [vec[0]*c - vec[1]*s, vec[0]*s + vec[1]*c, vec[2]];
      up = rotZ(up);
      right = rotZ(right);
    }

    // Roll around lens axis (deg -> rad)
    const roll = ((isRight ? cfg.rollDeg.right : cfg.rollDeg.left) * Math.PI) / 180.0;
    if (roll !== 0) {
      up = rotateAroundAxis(up, AXIS, roll);
      right = rotateAroundAxis(right, AXIS, roll);
    }

    return { AXIS, up, right };
  }

  const Rb = lensBasis(true);
  const Lb = lensBasis(false);

  /** Bilinear sample from source S at float coords (x, y). */
  function sampleBilinear(x, y) {
    const x0 = Math.max(0, Math.min(srcW - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(srcH - 2, Math.floor(y)));
    const tx = x - x0, ty = y - y0;

    const i00 = (y0 * srcW + x0) * 4;
    const i10 = i00 + 4;
    const i01 = i00 + srcW * 4;
    const i11 = i01 + 4;

    const r = S[i00]     * (1 - tx) * (1 - ty) + S[i10]     * tx * (1 - ty)
            + S[i01]     * (1 - tx) * ty       + S[i11]     * tx * ty;
    const g = S[i00 + 1] * (1 - tx) * (1 - ty) + S[i10 + 1] * tx * (1 - ty)
            + S[i01 + 1] * (1 - tx) * ty       + S[i11 + 1] * tx * ty;
    const b = S[i00 + 2] * (1 - tx) * (1 - ty) + S[i10 + 2] * tx * (1 - ty)
            + S[i01 + 2] * (1 - tx) * ty       + S[i11 + 2] * tx * ty;
    return [r, g, b];
  }

  const globalYaw = (cfg.globalYawDeg * Math.PI) / 180.0;

  for (let py = 0; py < panoH; py++) {
    const vLat = (py / panoH) * Math.PI - Math.PI / 2;
    const cosLat = Math.cos(vLat), sinLat = Math.sin(vLat);

    for (let px = 0; px < panoW; px++) {
      const vLon = ((px / panoW) * 2 * Math.PI - Math.PI) + globalYaw;

      // Unit direction for this panorama pixel
      const vx = cosLat * Math.cos(vLon);
      const vy = cosLat * Math.sin(vLon);
      const vz = sinLat;
      const v = [vx, vy, vz];

      /**
       * Map a 3D direction to fisheye image coords for the given lens.
       * Returns null if outside FOV or lens circle.
       */
      function mapLens(basis, cx, cy) {
        const dotAxis = v[0]*basis.AXIS[0] + v[1]*basis.AXIS[1] + v[2]*basis.AXIS[2];
        const theta = Math.acos(Math.max(-1, Math.min(1, dotAxis)));
        if (theta > halfFov) return null;

        const vu = v[0]*basis.up[0] + v[1]*basis.up[1] + v[2]*basis.up[2];
        const vr = v[0]*basis.right[0] + v[1]*basis.right[1] + v[2]*basis.right[2];
        const az = Math.atan2(vr, vu);

        const dist = f * theta;
        const sx = cx + dist * Math.sin(az);
        const sy = cy - dist * Math.cos(az);

        // crop to lens circle
        const dx = sx - cx, dy = sy - cy;
        if (dx*dx + dy*dy > radius*radius) return null;

        // feather weight toward lens center
        let w = 1.0 - (theta / halfFov);
        if (w < 0) w = 0;
        w = Math.pow(w, cfg.blend.gamma);

        return { sx, sy, w };
      }

      const mR = mapLens(Rb, cxR, cyR);
      const mL = mapLens(Lb, cxL, cyL);

      let r = 0, g = 0, b = 0, wsum = 0;

      if (mR) { const c = sampleBilinear(mR.sx, mR.sy); r += c[0] * mR.w; g += c[1] * mR.w; b += c[2] * mR.w; wsum += mR.w; }
      if (mL) { const c = sampleBilinear(mL.sx, mL.sy); r += c[0] * mL.w; g += c[1] * mL.w; b += c[2] * mL.w; wsum += mL.w; }

      const di = (py * panoW + px) * 4;
      if (wsum > 0) {
        D[di    ] = r / wsum;
        D[di + 1] = g / wsum;
        D[di + 2] = b / wsum;
        D[di + 3] = 255;
      } else {
        // Outside both lenses (rare with wide FOV): sample from the "closer" lens by hemisphere.
        const useRight = vx >= 0;
        const bbase = useRight ? Rb : Lb;
        const cx = useRight ? cxR : cxL;
        const cy = useRight ? cyR : cyL;

        const vu = v[0]*bbase.up[0] + v[1]*bbase.up[1] + v[2]*bbase.up[2];
        const vr = v[0]*bbase.right[0] + v[1]*bbase.right[1] + v[2]*bbase.right[2];
        const theta = Math.acos(Math.max(-1, Math.min(1, v[0]*bbase.AXIS[0] + v[1]*bbase.AXIS[1] + v[2]*bbase.AXIS[2])));
        const az = Math.atan2(vr, vu);
        const dist = f * theta;
        const sx = cx + dist * Math.sin(az);
        const sy = cy - dist * Math.cos(az);
        const c = sampleBilinear(sx, sy);
        D[di    ] = c[0];
        D[di + 1] = c[1];
        D[di + 2] = c[2];
        D[di + 3] = 255;
      }
    }

    // Yield periodically so the browser can render the spinner (trade tiny time for responsiveness).
    if ((py & 31) === 0) await new Promise(requestAnimationFrame);
  }

  panoCtx.putImageData(out, 0, 0);
  console.log('Stitching complete.');
}
