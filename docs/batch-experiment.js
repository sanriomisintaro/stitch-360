import { DEFAULT_CONFIG, stitchImageData } from './core/stitcher-core.js';
import { generateDualFisheyeImageData } from './core/synthetic-generator.js';
import { computeFullReferenceMetrics, computeSeamMetrics } from './core/metrics.js';
import { median, parseGammaList, rowsToCsv, summarizeByGamma } from './core/experiment-utils.js';

const $ = (id) => document.getElementById(id);
const filesInput = $('batchFiles');
const runBtn = $('runBatch');
const loader = $('batchLoader');
const loaderText = $('loaderText');
const status = $('batchStatus');
const rawRows = [];
let summaryRows = [];
let selectedFiles = [];

filesInput.addEventListener('change', () => {
  selectedFiles = [...(filesInput.files || [])];
  $('metricImages').textContent = String(selectedFiles.length);
  runBtn.disabled = selectedFiles.length === 0;
  status.textContent = selectedFiles.length
    ? `${selectedFiles.length} file(s) selected. Files with a non-2:1 ratio will be skipped.`
    : 'Select one or more 2:1 equirectangular panoramas.';
  updateGammaCount();
});
$('gammaList').addEventListener('input', updateGammaCount);
runBtn.addEventListener('click', runBatch);
$('downloadRawCsv').addEventListener('click', () => downloadText(rowsToCsv(rawRows), 'stitch360-sprint3-raw.csv', 'text/csv'));
$('downloadSummaryCsv').addEventListener('click', () => downloadText(rowsToCsv(summaryRows), 'stitch360-sprint3-summary.csv', 'text/csv'));

updateGammaCount();
$('metricEnv').textContent = `${navigator.hardwareConcurrency || '?'} threads`;

function updateGammaCount() {
  try { $('metricGammas').textContent = String(parseGammaList($('gammaList').value).length); }
  catch { $('metricGammas').textContent = '—'; }
}

async function runBatch() {
  let gammas;
  try { gammas = parseGammaList($('gammaList').value); }
  catch (error) { alert(error.message); return; }
  if (!selectedFiles.length) return;

  const seamHalfWidthDeg = Number($('seamHalfWidthDeg').value);
  const repeats = Math.max(1, Number.parseInt($('runtimeRepeats').value, 10) || 1);
  rawRows.length = 0;
  summaryRows = [];
  clearTables();
  setLoading(true);
  runBtn.disabled = true;

  let validImages = 0;
  try {
    for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
      const file = selectedFiles[fileIndex];
      loaderText.textContent = `Loading ${fileIndex + 1}/${selectedFiles.length}: ${file.name}`;
      await nextFrame();
      const image = await loadImageFromFile(file);
      const ratio = image.width / image.height;
      if (Math.abs(ratio - 2) > 0.03) {
        status.textContent = `Skipped ${file.name}: aspect ratio ${ratio.toFixed(3)} is not approximately 2:1.`;
        continue;
      }
      validImages++;
      const workingW = resolveWorkingWidth(image.width);
      const workingH = Math.round(workingW / 2);
      const gt = imageToRgba(image, workingW, workingH);
      const baseConfig = buildBaseConfig();
      const rightLensGain = Number($('rightLensGain').value);
      const generatorFovDelta = Number($('generatorFovDelta').value);
      const generatorConfig = {
        ...baseConfig,
        fovDeg: baseConfig.fovDeg + generatorFovDelta,
        centers: { left: [...baseConfig.centers.left], right: [...baseConfig.centers.right] },
        rollDeg: { ...baseConfig.rollDeg },
        yawBiasDeg: { ...baseConfig.yawBiasDeg },
        blend: { ...baseConfig.blend },
      };

      loaderText.textContent = `Generating synthetic dual-fisheye: ${file.name}`;
      await nextFrame();
      const genStart = performance.now();
      const dual = await generateDualFisheyeImageData({
        panoData: gt,
        panoW: workingW,
        panoH: workingH,
        srcW: workingW,
        srcH: workingH,
        config: generatorConfig,
        photometric: { right: { gain: rightLensGain }, left: { gain: 1 } },
        yieldEveryRows: 16,
        yieldControl: nextFrame,
      });
      const generatorMs = performance.now() - genStart;

      for (let gammaIndex = 0; gammaIndex < gammas.length; gammaIndex++) {
        const gamma = gammas[gammaIndex];
        loaderText.textContent = `${file.name}: γ=${gamma} (${gammaIndex + 1}/${gammas.length})`;
        await nextFrame();
        const config = {
          ...baseConfig,
          blend: { enable: true, gamma },
        };

        let reconstruction = null;
        const timings = [];
        for (let r = 0; r < repeats; r++) {
          const t0 = performance.now();
          reconstruction = await stitchImageData({
            srcData: dual.data,
            srcW: dual.width,
            srcH: dual.height,
            panoW: workingW,
            panoH: workingH,
            config,
            yieldEveryRows: 16,
            yieldControl: nextFrame,
          });
          timings.push(performance.now() - t0);
        }

        const full = computeFullReferenceMetrics(gt, reconstruction.data, workingW, workingH);
        const seam = computeSeamMetrics(gt, reconstruction.data, workingW, workingH, { seamHalfWidthDeg });
        const row = {
          image: file.name,
          gamma,
          width: workingW,
          height: workingH,
          fovDeg: baseConfig.fovDeg,
          radiusScale: baseConfig.radiusScale,
          rightLensGain,
          generatorFovDelta,
          seamHalfWidthDeg,
          repeats,
          mse: full.mse,
          mae: full.mae,
          psnr: full.psnr,
          ssim: full.ssim,
          seamMse: seam.mse,
          seamMae: seam.mae,
          seamPsnr: seam.psnr,
          seamSsim: seam.ssim,
          seamGradientError: seam.gradientError,
          seamPixels: seam.pixels,
          runtimeMs: median(timings),
          runtimeMinMs: Math.min(...timings),
          runtimeMaxMs: Math.max(...timings),
          generatorMs,
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency || '',
          deviceMemoryGB: navigator.deviceMemory || '',
        };
        rawRows.push(row);
        appendRawRow(row);
        $('metricRows').textContent = String(rawRows.length);
      }
    }

    summaryRows = summarizeByGamma(rawRows);
    renderSummary(summaryRows);
    drawChart(summaryRows);
    $('downloadRawCsv').disabled = rawRows.length === 0;
    $('downloadSummaryCsv').disabled = summaryRows.length === 0;
    status.textContent = rawRows.length
      ? `Complete: ${validImages} valid image(s), ${rawRows.length} image×gamma result rows.`
      : 'No valid 2:1 images were processed.';
  } catch (error) {
    console.error(error);
    status.textContent = `Batch experiment failed: ${error.message || error}`;
  } finally {
    setLoading(false);
    runBtn.disabled = selectedFiles.length === 0;
  }
}

function buildBaseConfig() {
  return {
    ...DEFAULT_CONFIG,
    fovDeg: Number($('fovDeg').value),
    radiusScale: Number($('radiusScale').value),
    centers: { left: [...DEFAULT_CONFIG.centers.left], right: [...DEFAULT_CONFIG.centers.right] },
    rollDeg: { ...DEFAULT_CONFIG.rollDeg },
    yawBiasDeg: { ...DEFAULT_CONFIG.yawBiasDeg },
    blend: { enable: true, gamma: 2 },
  };
}

function resolveWorkingWidth(nativeWidth) {
  const v = $('workingWidth').value;
  return v === 'native' ? nativeWidth : Math.min(nativeWidth, Number.parseInt(v, 10));
}

function imageToRgba(image, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

function appendRawRow(row) {
  const tr = document.createElement('tr');
  const values = [
    row.image, fmt(row.gamma, 2), `${row.width}×${row.height}`, fmt(row.psnr, 3), fmt(row.ssim, 5), fmt(row.mae, 3),
    fmt(row.seamPsnr, 3), fmt(row.seamSsim, 5), fmt(row.seamMae, 3), fmt(row.seamGradientError, 3),
    fmt(row.runtimeMs, 1), fmt(row.generatorMs, 1),
  ];
  for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }
  $('rawTable').querySelector('tbody').appendChild(tr);
}

function renderSummary(rows) {
  const tbody = $('summaryTable').querySelector('tbody');
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    const values = [
      fmt(row.gamma, 2), row.n,
      `${fmt(row.psnrMean, 3)} ± ${fmt(row.psnrSd, 3)}`,
      `${fmt(row.ssimMean, 5)} ± ${fmt(row.ssimSd, 5)}`,
      `${fmt(row.seamPsnrMean, 3)} ± ${fmt(row.seamPsnrSd, 3)}`,
      `${fmt(row.seamSsimMean, 5)} ± ${fmt(row.seamSsimSd, 5)}`,
      `${fmt(row.seamMaeMean, 3)} ± ${fmt(row.seamMaeSd, 3)}`,
      `${fmt(row.seamGradientErrorMean, 3)} ± ${fmt(row.seamGradientErrorSd, 3)}`,
      `${fmt(row.runtimeMsMean, 1)} ± ${fmt(row.runtimeMsSd, 1)}`,
    ];
    for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }
    tbody.appendChild(tr);
  }
}

function drawChart(rows) {
  const canvas = $('ablationChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!rows.length) return;

  const margin = { l: 70, r: 70, t: 35, b: 60 };
  const plotW = canvas.width - margin.l - margin.r;
  const plotH = canvas.height - margin.t - margin.b;
  const gammas = rows.map(r => r.gamma);
  const minG = Math.min(...gammas), maxG = Math.max(...gammas);
  const psnrs = rows.map(r => r.psnrMean).filter(Number.isFinite);
  const minP = Math.floor(Math.min(...psnrs) - 1), maxP = Math.ceil(Math.max(...psnrs) + 1);
  const xScale = g => margin.l + (maxG === minG ? .5 : (g - minG) / (maxG - minG)) * plotW;
  const yP = p => margin.t + (1 - (p - minP) / Math.max(1e-9, maxP - minP)) * plotH;
  const yS = s => margin.t + (1 - s) * plotH;

  ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(margin.l, margin.t); ctx.lineTo(margin.l, margin.t + plotH); ctx.lineTo(margin.l + plotW, margin.t + plotH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(margin.l + plotW, margin.t); ctx.lineTo(margin.l + plotW, margin.t + plotH); ctx.stroke();

  ctx.fillStyle = '#222'; ctx.font = '14px sans-serif';
  ctx.fillText('PSNR (dB)', 8, 22); ctx.fillText('SSIM', canvas.width - 48, 22); ctx.fillText('Feather gamma (γ)', canvas.width / 2 - 55, canvas.height - 16);

  // Let the browser choose default CSS colors by deriving from current text; two line patterns distinguish series.
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.setLineDash([]);
  ctx.beginPath(); rows.forEach((r, i) => { const x=xScale(r.gamma), y=yP(r.psnrMean); if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.stroke();
  ctx.setLineDash([8, 6]);
  ctx.beginPath(); rows.forEach((r, i) => { const x=xScale(r.gamma), y=yS(r.ssimMean); if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.stroke(); ctx.setLineDash([]);

  for (const r of rows) {
    const x = xScale(r.gamma);
    ctx.fillStyle = '#222'; ctx.fillRect(x - 3, yP(r.psnrMean) - 3, 6, 6);
    ctx.strokeStyle = '#222'; ctx.strokeRect(x - 4, yS(r.ssimMean) - 4, 8, 8);
    ctx.fillStyle = '#222'; ctx.fillText(String(r.gamma), x - 8, margin.t + plotH + 22);
  }
  ctx.fillText(`PSNR solid | SSIM dashed`, margin.l + 10, margin.t + 18);
  ctx.fillText(`${minP}`, 28, margin.t + plotH); ctx.fillText(`${maxP}`, 28, margin.t + 5);
  ctx.fillText('0', canvas.width - 55, margin.t + plotH); ctx.fillText('1', canvas.width - 55, margin.t + 5);
}

function clearTables() {
  $('rawTable').querySelector('tbody').innerHTML = '';
  $('summaryTable').querySelector('tbody').innerHTML = '';
  $('metricRows').textContent = '0';
  $('downloadRawCsv').disabled = true;
  $('downloadSummaryCsv').disabled = true;
  const c = $('ablationChart'); c.getContext('2d').clearRect(0,0,c.width,c.height);
}

function fmt(value, digits) {
  if (value === Infinity) return '∞';
  if (!Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits);
}
function setLoading(on) { loader.classList.toggle('hidden', !on); }
function nextFrame() { return new Promise(requestAnimationFrame); }
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = event.target.result; };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}
function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
