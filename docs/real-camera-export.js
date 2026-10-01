import { DEFAULT_CONFIG, stitchImageData } from './core/stitcher-core.js';
import { rowsToCsv } from './core/experiment-utils.js';
import { createStoredZip } from './core/zip-store.js';

const $=id=>document.getElementById(id); let selected=[];
$('files').addEventListener('change',()=>{selected=[...($('files').files||[])];$('run').disabled=!selected.length;$('status').textContent=selected.length?`${selected.length} file(s) selected.`:'Select one or more real dual-fisheye images.';});
$('run').addEventListener('click',build);

async function build(){
 if(!selected.length)return; $('run').disabled=true; setLoading(true); const entries=[], rows=[]; const cfg=readConfig();
 const seam=Number($('seamHalfWidthDeg').value), category=$('sceneCategory').value, distance=$('distanceClass').value;
 try{
  let valid=0;
  for(let i=0;i<selected.length;i++){
   const file=selected[i]; $('loaderText').textContent=`Processing ${i+1}/${selected.length}: ${file.name}`; await nextFrame();
   const image=await loadImage(file); if(Math.abs(image.width/image.height-2)>0.08){console.warn('Skipped non-2:1 input',file.name);continue;}
   valid++; const srcW=resolveWidth(image.width),srcH=Math.round(srcW/2),panoW=srcW,panoH=Math.round(panoW/2);
   const raw=imageToRgba(image,srcW,srcH); const t0=performance.now();
   const rec=await stitchImageData({srcData:raw,srcW,srcH,panoW,panoH,config:cfg,yieldEveryRows:16,yieldControl:nextFrame});
   const runtimeMs=performance.now()-t0; const id=`${String(valid).padStart(3,'0')}_${slug(file.name.replace(/\.[^.]+$/,''))}`;
   entries.push({name:`images/${id}/raw_dual_fisheye.png`,data:await rgbaToPngBlob(raw,srcW,srcH)},{name:`images/${id}/stitch360.png`,data:await rgbaToPngBlob(rec.data,panoW,panoH)});
   rows.push({id,image:file.name,sceneCategory:category,distanceClass:distance,width:panoW,height:panoH,sourceWidth:srcW,sourceHeight:srcH,fovDeg:cfg.fovDeg,radiusScale:cfg.radiusScale,gamma:cfg.blend.gamma,seamHalfWidthDeg:seam,calibrationSetId:$('calibrationSetId').value.trim()||'CAL-01',cameraModel:$('cameraModel').value.trim(),rawDualFisheye:`images/${id}/raw_dual_fisheye.png`,stitch360:`images/${id}/stitch360.png`,stitch360RuntimeMs:runtimeMs});
  }
  if(!rows.length)throw new Error('No valid side-by-side dual-fisheye images were processed. Expected approximately 2:1 input.');
  const capture={schemaVersion:1,purpose:'Stitch 360 Sprint 6 real-camera validation bundle',createdAt:new Date().toISOString(),cameraModel:$('cameraModel').value.trim(),sceneCategory:category,distanceClass:distance,batchNotes:$('notes').value.trim(),browser:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency||null,deviceMemoryGB:navigator.deviceMemory||null,protocol:'One calibration set must be frozen across all test scenes.'};
  entries.unshift({name:'manifest.csv',data:rowsToCsv(rows)},{name:'calibration.json',data:JSON.stringify(cfg,null,2)},{name:'capture-metadata.json',data:JSON.stringify(capture,null,2)});
  $('loaderText').textContent='Packing ZIP…'; await nextFrame(); const zip=await createStoredZip(entries); downloadBlob(zip,`stitch360-real-camera-${dateStamp()}.zip`); $('status').textContent=`Bundle complete: ${rows.length} image(s).`;
 }catch(e){console.error(e);$('status').textContent=`Export failed: ${e.message||e}`;}finally{setLoading(false);$('run').disabled=!selected.length;}
}
function readConfig(){return {...DEFAULT_CONFIG,fovDeg:Number($('fovDeg').value),radiusScale:Number($('radiusScale').value),centers:{left:[Number($('centerLX').value),Number($('centerLY').value)],right:[Number($('centerRX').value),Number($('centerRY').value)]},rollDeg:{left:Number($('rollL').value),right:Number($('rollR').value)},yawBiasDeg:{left:Number($('yawL').value),right:Number($('yawR').value)},globalYawDeg:Number($('globalYaw').value),blend:{enable:true,gamma:Number($('gamma').value)}};}
function resolveWidth(nativeWidth){const v=$('workingWidth').value;return v==='native'?nativeWidth:Math.min(nativeWidth,Number(v));}
function imageToRgba(image,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0,w,h);return x.getImageData(0,0,w,h).data;}
function rgbaToPngBlob(data,w,h){return new Promise((resolve,reject)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.putImageData(new ImageData(new Uint8ClampedArray(data),w,h),0,0);c.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png');});}
function loadImage(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=e=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=e.target.result};r.onerror=reject;r.readAsDataURL(file);});}
function nextFrame(){return new Promise(requestAnimationFrame);} function setLoading(on){$('loader').classList.toggle('hidden',!on);} function slug(s){return s.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||'image';} function dateStamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000);}
