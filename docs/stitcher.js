/**
 * Stitch 360 browser adapter.
 * Algorithmic code lives in ./core so it can be tested and benchmarked without the DOM.
 */

import { DEFAULT_CONFIG, stitchImageData } from './core/stitcher-core.js';

const imageLoader = document.getElementById('imageLoader');
const sourceCanvas = document.getElementById('sourceCanvas');
const panoramaCanvas = document.getElementById('panoramaCanvas');
const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
const panoCtx = panoramaCanvas.getContext('2d', { willReadFrequently: true });
const loaderEl = document.getElementById('loader');
const actionsEl = document.getElementById('actions');
const downloadBtn = document.getElementById('downloadBtn');
const downloadJpgBtn = document.getElementById('downloadJpgBtn');
const jpgQuality = document.getElementById('jpgQuality');
const jpgQualityVal = document.getElementById('jpgQualityVal');
const jpgScale = document.getElementById('jpgScale');

const cfg = {
  ...DEFAULT_CONFIG,
  centers: {
    left: [...DEFAULT_CONFIG.centers.left],
    right: [...DEFAULT_CONFIG.centers.right],
  },
  rollDeg: { ...DEFAULT_CONFIG.rollDeg },
  yawBiasDeg: { ...DEFAULT_CONFIG.yawBiasDeg },
  blend: { ...DEFAULT_CONFIG.blend },
};

let lastBaseName = 'panorama';

function setLoading(isOn) {
  if (loaderEl) loaderEl.classList.toggle('hidden', !isOn);
}

function setActionsVisible(isOn) {
  if (actionsEl) actionsEl.classList.toggle('hidden', !isOn);
}

imageLoader.addEventListener('change', onFile, false);
if (downloadBtn) downloadBtn.addEventListener('click', onDownloadPng, false);
if (downloadJpgBtn) downloadJpgBtn.addEventListener('click', onDownloadJpg, false);

if (jpgQuality && jpgQualityVal) {
  const updateQ = () => {
    jpgQualityVal.textContent = `${Math.round(parseFloat(jpgQuality.value) * 100)}%`;
  };
  jpgQuality.addEventListener('input', updateQ, false);
  updateQ();
}

async function onFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setActionsVisible(false);
  lastBaseName = (file.name || 'panorama').replace(/\.[^.]+$/, '');

  try {
    setLoading(true);
    const img = await loadImageFromFile(file);

    sourceCanvas.width = img.width;
    sourceCanvas.height = img.height;
    sourceCtx.drawImage(img, 0, 0);

    const panoW = Math.round(img.width * cfg.scale);
    const panoH = Math.round(panoW / 2);
    panoramaCanvas.width = panoW;
    panoramaCanvas.height = panoH;

    await new Promise(requestAnimationFrame);

    const source = sourceCtx.getImageData(0, 0, img.width, img.height);
    const stitched = await stitchImageData({
      srcData: source.data,
      srcW: img.width,
      srcH: img.height,
      panoW,
      panoH,
      config: cfg,
      yieldEveryRows: 32,
      yieldControl: () => new Promise(requestAnimationFrame),
    });

    const out = panoCtx.createImageData(stitched.width, stitched.height);
    out.data.set(stitched.data);
    panoCtx.putImageData(out, 0, 0);

    setActionsVisible(true);
  } catch (err) {
    console.error(err);
    alert(`Stitching failed: ${err?.message || err}`);
  } finally {
    setLoading(false);
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function exportCanvas(canvas, { mime = 'image/png', quality = 0.92, scale = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const transform = (canvas.style.transform || '').replace(/\s/g, '');
    const match = /rotate\(([-\d.]+)deg\)/.exec(transform);
    const needs180 = match && Math.abs(parseFloat(match[1]) % 360) === 180;

    const needsOffscreen = needs180 || scale !== 1 || mime === 'image/jpeg';
    if (!needsOffscreen) {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
        mime,
        quality
      );
      return;
    }

    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(canvas.width * scale));
    off.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = off.getContext('2d');

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

    off.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      mime,
      quality
    );
  });
}

async function onDownloadPng() {
  try {
    downloadBtn.disabled = true;
    if (downloadJpgBtn) downloadJpgBtn.disabled = true;
    const blob = await exportCanvas(panoramaCanvas, {
      mime: 'image/png',
      quality: 0.92,
      scale: 1,
    });
    triggerDownload(blob, `${lastBaseName}-stitched.png`);
  } catch (err) {
    console.error(err);
    alert(`Download failed: ${err?.message || err}`);
  } finally {
    downloadBtn.disabled = false;
    if (downloadJpgBtn) downloadJpgBtn.disabled = false;
  }
}

async function onDownloadJpg() {
  try {
    if (downloadBtn) downloadBtn.disabled = true;
    downloadJpgBtn.disabled = true;
    const quality = jpgQuality ? parseFloat(jpgQuality.value) : 0.85;
    const scale = jpgScale ? parseFloat(jpgScale.value) : 1;
    const blob = await exportCanvas(panoramaCanvas, {
      mime: 'image/jpeg',
      quality,
      scale,
    });
    const suffix = scale === 1 ? '' : `-${Math.round(scale * 100)}pct`;
    triggerDownload(blob, `${lastBaseName}-stitched${suffix}.jpg`);
  } catch (err) {
    console.error(err);
    alert(`Download failed: ${err?.message || err}`);
  } finally {
    if (downloadBtn) downloadBtn.disabled = false;
    downloadJpgBtn.disabled = false;
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
