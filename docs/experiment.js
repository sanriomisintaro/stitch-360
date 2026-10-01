import { DEFAULT_CONFIG } from './core/stitcher-core.js';
import { stitchImageData } from './core/stitcher-core.js';
import { generateDualFisheyeImageData } from './core/synthetic-generator.js';
import { computeFullReferenceMetrics, computeSeamMetrics } from './core/metrics.js';

const $ = (id) => document.getElementById(id);
const input = $('gtLoader');
const runBtn = $('runExperiment');
const loader = $('experimentLoader');
const status = $('status');
const gtCanvas = $('gtCanvas');
const dfCanvas = $('dfCanvas');
const recCanvas = $('recCanvas');
const gtCtx = gtCanvas.getContext('2d', { willReadFrequently: true });
const dfCtx = dfCanvas.getContext('2d', { willReadFrequently: true });
const recCtx = recCanvas.getContext('2d', { willReadFrequently: true });

let loadedImage = null;
let baseName = 'experiment';

input.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  baseName = (file.name || 'experiment').replace(/\.[^.]+$/, '');
  try {
    loadedImage = await loadImageFromFile(file);
    runBtn.disabled = false;
    status.textContent = `Loaded ${loadedImage.width}×${loadedImage.height}. Ready to run.`;
  } catch (error) {
    loadedImage = null;
    runBtn.disabled = true;
    status.textContent = `Could not load image: ${error.message || error}`;
  }
});

runBtn.addEventListener('click', runExperiment);
$('downloadDf').addEventListener('click', () => downloadCanvas(dfCanvas, `${baseName}-synthetic-dual-fisheye.png`));
$('downloadRec').addEventListener('click', () => downloadCanvas(recCanvas, `${baseName}-reconstructed.png`));

async function runExperiment() {
  if (!loadedImage) return;

  const ratio = loadedImage.width / loadedImage.height;
  if (Math.abs(ratio - 2) > 0.03) {
    alert(`Ground-truth panorama must be approximately 2:1. Current ratio: ${ratio.toFixed(3)}.`);
    return;
  }

  setLoading(true);
  runBtn.disabled = true;
  try {
    const workingW = resolveWorkingWidth(loadedImage.width);
    const workingH = Math.round(workingW / 2);
    const config = buildConfig();

    gtCanvas.width = workingW;
    gtCanvas.height = workingH;
    gtCtx.drawImage(loadedImage, 0, 0, workingW, workingH);
    const gt = gtCtx.getImageData(0, 0, workingW, workingH);

    status.textContent = 'Generating synthetic dual-fisheye image…';
    await nextFrame();
    const genStart = performance.now();
    const dual = await generateDualFisheyeImageData({
      panoData: gt.data,
      panoW: workingW,
      panoH: workingH,
      srcW: workingW,
      srcH: workingH,
      config,
      yieldEveryRows: 16,
      yieldControl: nextFrame,
    });
    const genMs = performance.now() - genStart;
    putRgba(dfCtx, dfCanvas, dual.data, dual.width, dual.height);

    status.textContent = 'Reconstructing panorama with Stitch 360…';
    await nextFrame();
    const stitchStart = performance.now();
    const reconstructed = await stitchImageData({
      srcData: dual.data,
      srcW: dual.width,
      srcH: dual.height,
      panoW: workingW,
      panoH: workingH,
      config,
      yieldEveryRows: 16,
      yieldControl: nextFrame,
    });
    const stitchMs = performance.now() - stitchStart;
    putRgba(recCtx, recCanvas, reconstructed.data, reconstructed.width, reconstructed.height);

    const full = computeFullReferenceMetrics(gt.data, reconstructed.data, workingW, workingH);
    const seam = computeSeamMetrics(gt.data, reconstructed.data, workingW, workingH, { seamHalfWidthDeg: 10 });

    $('metricMse').textContent = full.mse.toFixed(3);
    $('metricPsnr').textContent = Number.isFinite(full.psnr) ? `${full.psnr.toFixed(2)} dB` : '∞ dB';
    $('metricSsim').textContent = full.ssim.toFixed(5);
    $('metricSeamPsnr').textContent = Number.isFinite(seam.psnr) ? `${seam.psnr.toFixed(2)} dB` : '∞ dB';
    $('metricSeamSsim').textContent = seam.ssim.toFixed(5);
    $('metricGenerate').textContent = `${genMs.toFixed(1)} ms`;
    $('metricStitch').textContent = `${stitchMs.toFixed(1)} ms`;
    $('metricResolution').textContent = `${workingW}×${workingH}`;
    $('metricGamma').textContent = config.blend.gamma.toFixed(2);

    $('downloadDf').disabled = false;
    $('downloadRec').disabled = false;
    status.textContent = 'Round-trip experiment complete. Full-reference and nominal seam-band metrics are computed against the ground-truth panorama.';
  } catch (error) {
    console.error(error);
    status.textContent = `Experiment failed: ${error.message || error}`;
  } finally {
    setLoading(false);
    runBtn.disabled = false;
  }
}

function buildConfig() {
  return {
    ...DEFAULT_CONFIG,
    fovDeg: parseFloat($('fovDeg').value),
    radiusScale: parseFloat($('radiusScale').value),
    centers: {
      left: [...DEFAULT_CONFIG.centers.left],
      right: [...DEFAULT_CONFIG.centers.right],
    },
    rollDeg: { ...DEFAULT_CONFIG.rollDeg },
    yawBiasDeg: { ...DEFAULT_CONFIG.yawBiasDeg },
    blend: {
      enable: true,
      gamma: parseFloat($('gamma').value),
    },
  };
}

function resolveWorkingWidth(nativeWidth) {
  const selected = $('workingWidth').value;
  if (selected === 'native') return nativeWidth;
  return Math.min(nativeWidth, parseInt(selected, 10));
}

function setLoading(on) {
  loader.classList.toggle('hidden', !on);
}

function nextFrame() {
  return new Promise(requestAnimationFrame);
}

function putRgba(ctx, canvas, data, width, height) {
  canvas.width = width;
  canvas.height = height;
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(data);
  ctx.putImageData(imageData, 0, 0);
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

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}
