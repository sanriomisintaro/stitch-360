import { DEFAULT_CONFIG, stitchImageData } from './core/stitcher-core.js';
import { generateDualFisheyeImageData } from './core/synthetic-generator.js';
import { computeFullReferenceMetrics, computeSeamMetrics } from './core/metrics.js';
import { rowsToCsv } from './core/experiment-utils.js';
import { createStoredZip } from './core/zip-store.js';

const $ = id => document.getElementById(id);
let selected = [];
$('files').addEventListener('change', () => {
  selected = [...($('files').files || [])];
  $('run').disabled = selected.length === 0;
  $('status').textContent = selected.length ? `${selected.length} file(s) selected.` : 'Select one or more 2:1 panoramas.';
});
$('run').addEventListener('click', buildBundle);

async function buildBundle() {
  if (!selected.length) return;
  $('run').disabled = true; setLoading(true);
  const entries = [];
  const manifest = [];
  const cfg = baseConfig();
  const generatorFovDelta = Number($('generatorFovDelta').value);
  const rightLensGain = Number($('rightLensGain').value);
  const seamHalfWidthDeg = Number($('seamHalfWidthDeg').value);
  const gamma = Number($('gamma').value);

  try {
    let valid = 0;
    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      $('loaderText').textContent = `Processing ${i+1}/${selected.length}: ${file.name}`;
      await nextFrame();
      const image = await loadImage(file);
      if (Math.abs(image.width / image.height - 2) > 0.03) continue;
      valid++;
      const width = resolveWorkingWidth(image.width);
      const height = Math.round(width / 2);
      const gt = imageToRgba(image, width, height);
      const genCfg = cloneConfig(cfg);
      genCfg.fovDeg += generatorFovDelta;
      const tGen = performance.now();
      const dual = await generateDualFisheyeImageData({
        panoData: gt, panoW: width, panoH: height, srcW: width, srcH: height,
        config: genCfg,
        photometric: { left: { gain: 1 }, right: { gain: rightLensGain } },
        yieldEveryRows: 16, yieldControl: nextFrame,
      });
      const generatorMs = performance.now() - tGen;
      const stitchCfg = cloneConfig(cfg); stitchCfg.blend.gamma = gamma;
      const t0 = performance.now();
      const rec = await stitchImageData({
        srcData: dual.data, srcW: dual.width, srcH: dual.height, panoW: width, panoH: height,
        config: stitchCfg, yieldEveryRows: 16, yieldControl: nextFrame,
      });
      const runtimeMs = performance.now() - t0;
      const full = computeFullReferenceMetrics(gt, rec.data, width, height);
      const seam = computeSeamMetrics(gt, rec.data, width, height, { seamHalfWidthDeg });
      const id = `${String(valid).padStart(3,'0')}_${slug(file.name.replace(/\.[^.]+$/,''))}`;
      entries.push(
        { name: `images/${id}/ground_truth.png`, data: await rgbaToPngBlob(gt, width, height) },
        { name: `images/${id}/dual_fisheye.png`, data: await rgbaToPngBlob(dual.data, width, height) },
        { name: `images/${id}/stitch360.png`, data: await rgbaToPngBlob(rec.data, width, height) },
      );
      const condition = classifyCondition(rightLensGain, generatorFovDelta);
      manifest.push({
        id, image:file.name, condition, width, height, fovDeg:cfg.fovDeg, radiusScale:cfg.radiusScale,
        gamma, rightLensGain, generatorFovDelta, seamHalfWidthDeg,
        groundTruth:`images/${id}/ground_truth.png`, dualFisheye:`images/${id}/dual_fisheye.png`, stitch360:`images/${id}/stitch360.png`,
        stitch360Psnr:full.psnr, stitch360Ssim:full.ssim, stitch360Mae:full.mae,
        stitch360SeamPsnr:seam.psnr, stitch360SeamSsim:seam.ssim, stitch360SeamMae:seam.mae,
        stitch360SeamGradientError:seam.gradientError, stitch360RuntimeMs:runtimeMs, generatorMs,
      });
    }
    if (!manifest.length) throw new Error('No valid 2:1 panoramas were processed.');
    const config = {
      schemaVersion: 1,
      purpose: 'Stitch 360 Sprint 5 external-baseline bundle',
      createdAt: new Date().toISOString(),
      fovDeg: cfg.fovDeg, radiusScale: cfg.radiusScale, gamma, rightLensGain, generatorFovDelta, seamHalfWidthDeg,
      condition: classifyCondition(rightLensGain, generatorFovDelta),
      browser: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency || null, deviceMemoryGB: navigator.deviceMemory || null,
      note: 'Synthetic dual-fisheye input and Stitch 360 reconstruction were generated from the same ground-truth panorama in the browser.'
    };
    entries.unshift({ name:'manifest.csv', data:rowsToCsv(manifest) }, { name:'experiment-config.json', data:JSON.stringify(config,null,2) });
    $('loaderText').textContent = 'Packing ZIP…'; await nextFrame();
    const zip = await createStoredZip(entries);
    downloadBlob(zip, `stitch360-baseline-bundle-${dateStamp()}.zip`);
    $('status').textContent = `Bundle complete: ${manifest.length} panorama(s), ${entries.length} files.`;
  } catch (err) {
    console.error(err); $('status').textContent = `Export failed: ${err.message || err}`;
  } finally { setLoading(false); $('run').disabled = selected.length === 0; }
}

function baseConfig(){ return {...DEFAULT_CONFIG, fovDeg:Number($('fovDeg').value), radiusScale:Number($('radiusScale').value), centers:{left:[...DEFAULT_CONFIG.centers.left],right:[...DEFAULT_CONFIG.centers.right]}, rollDeg:{...DEFAULT_CONFIG.rollDeg}, yawBiasDeg:{...DEFAULT_CONFIG.yawBiasDeg}, blend:{enable:true,gamma:Number($('gamma').value)}}; }
function cloneConfig(c){ return {...c,centers:{left:[...c.centers.left],right:[...c.centers.right]},rollDeg:{...c.rollDeg},yawBiasDeg:{...c.yawBiasDeg},blend:{...c.blend}}; }
function resolveWorkingWidth(nativeWidth){ const v=$('workingWidth').value; return v==='native'?nativeWidth:Math.min(nativeWidth,Number.parseInt(v,10)); }
function imageToRgba(image,w,h){ const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0,w,h);return x.getImageData(0,0,w,h).data; }
function rgbaToPngBlob(data,w,h){ return new Promise((resolve,reject)=>{ const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.putImageData(new ImageData(new Uint8ClampedArray(data),w,h),0,0);c.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'); }); }
function loadImage(file){ return new Promise((resolve,reject)=>{ const r=new FileReader();r.onload=e=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=e.target.result};r.onerror=reject;r.readAsDataURL(file); }); }
function nextFrame(){ return new Promise(requestAnimationFrame); }
function setLoading(on){ $('loader').classList.toggle('hidden',!on); }
function slug(s){ return s.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||'image'; }
function classifyCondition(gain, delta){
  const g=Math.abs(gain-1)<1e-9, d=Math.abs(delta)<1e-9;
  if(g&&d)return 'C0 Clean'; if(!g&&d)return 'C1 Photometric'; if(g&&!d)return 'C2 Calibration'; return 'C3 Combined';
}
function dateStamp(){ return new Date().toISOString().replace(/[:.]/g,'-'); }
function downloadBlob(blob,name){ const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000); }
