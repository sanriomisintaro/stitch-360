#!/usr/bin/env python3
"""Sprint 6 real-camera benchmark for Stitch 360.

No ground truth is assumed. The script compares Stitch 360, FFmpeg v360, and
Hugin on the same real dual-fisheye input using reproducible runtime and
no-reference seam-continuity proxies. These proxies are not full perceptual
quality metrics and should be interpreted together with blinded human ratings.
"""
from __future__ import annotations
import argparse,csv,json,math,shutil,statistics,sys
from pathlib import Path
import numpy as np
from PIL import Image
from baseline_benchmark import run_ffmpeg,run_hugin,summarize_timings,tool_environment

METHODS={'stitch360':'stitch360','ffmpeg':'ffmpeg_v360','hugin':'hugin_known_geometry'}

def read_manifest(bundle:Path):
 p=bundle/'manifest.csv'
 with p.open(newline='',encoding='utf-8-sig') as f: rows=list(csv.DictReader(f))
 req={'id','image','width','height','fovDeg','seamHalfWidthDeg','rawDualFisheye','stitch360'}
 if not rows: raise ValueError('manifest.csv is empty')
 miss=req-set(rows[0]);
 if miss: raise ValueError(f'manifest.csv missing columns: {sorted(miss)}')
 return rows

def load_rgb(path:Path):
 with Image.open(path) as im:return np.asarray(im.convert('RGB'),dtype=np.float64)

def luma(a):return .2126*a[...,0]+.7152*a[...,1]+.0722*a[...,2]

def seam_columns(width:int): return [int(round(width*.25)),int(round(width*.75))]

def real_metrics(path:Path,seam_half_width_deg:float):
 a=load_rgb(path); y=luma(a); h,w,_=a.shape; gx=np.abs(np.diff(y,axis=1)); rgbdiff=np.linalg.norm(np.diff(a,axis=1),axis=2)
 half=max(2,int(round(w*seam_half_width_deg/360.0))); jumps=[]; cjumps=[]; ratios=[]; cratios=[]
 for c in seam_columns(w):
  c=max(1,min(w-1,c)); jumps.append(float(np.mean(np.abs(y[:,c]-y[:,c-1])))); cjumps.append(float(np.mean(np.linalg.norm(a[:,c]-a[:,c-1],axis=1))))
  lo=max(0,c-half); hi=min(w-1,c+half); idx=[j for j in range(lo,hi) if abs(j-(c-1))>2]
  local=float(np.mean(gx[:,idx])) if idx else math.nan; localc=float(np.mean(rgbdiff[:,idx])) if idx else math.nan
  ratios.append(jumps[-1]/local if local and np.isfinite(local) else math.nan); cratios.append(cjumps[-1]/localc if localc and np.isfinite(localc) else math.nan)
 # detail-retention proxy; scene-dependent, so compare paired outputs only.
 lap=-4*y+np.roll(y,1,0)+np.roll(y,-1,0)+np.roll(y,1,1)+np.roll(y,-1,1)
 return {'seamLumaJump':float(np.mean(jumps)),'seamRgbJump':float(np.mean(cjumps)),'seamGradientRatio':float(np.nanmean(ratios)),'seamRgbRatio':float(np.nanmean(cratios)),'horizontalTV':float(np.mean(gx)),'laplacianVariance':float(np.var(lap)),'meanLuma':float(np.mean(y))}

def write_csv(p,rows):
 if not rows:return
 with p.open('w',newline='',encoding='utf-8') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)

def main(argv=None):
 ap=argparse.ArgumentParser();ap.add_argument('--bundle',type=Path,required=True);ap.add_argument('--out',type=Path,default=Path('real-benchmark-output'));ap.add_argument('--methods',default='stitch360,ffmpeg,hugin');ap.add_argument('--repeats',type=int,default=3);ap.add_argument('--warmup',type=int,default=1);ap.add_argument('--ffmpeg-bin',default='ffmpeg');ap.add_argument('--ffmpeg-interp',default='linear',choices=['nearest','linear','cubic','lanczos']);ap.add_argument('--strict-missing-tools',action='store_true');args=ap.parse_args(argv)
 bundle=args.bundle.resolve();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True);outputs=out/'outputs';outputs.mkdir(exist_ok=True);rows=read_manifest(bundle);requested={x.strip() for x in args.methods.split(',') if x.strip()};env=tool_environment();(out/'environment.json').write_text(json.dumps(env,indent=2),encoding='utf-8');results=[];commands=[]
 for i,item in enumerate(rows,1):
  W,H=int(float(item['width'])),int(float(item['height']));fov=float(item['fovDeg']);seam=float(item['seamHalfWidthDeg']);raw=bundle/item['rawDualFisheye'];s360=bundle/item['stitch360'];base={k:item.get(k,'') for k in ['id','image','sceneCategory','distanceClass','cameraModel','calibrationSetId']};base|={'width':W,'height':H,'fovDeg':fov,'seamHalfWidthDeg':seam};print(f"[{i}/{len(rows)}] {item['image']}",flush=True)
  if 'stitch360' in requested:
   dst=outputs/f"{item['id']}__stitch360.png";shutil.copy2(s360,dst);m=real_metrics(dst,seam);rt=float(item.get('stitch360RuntimeMs') or math.nan);results.append({**base,'method':'stitch360','status':'ok',**m,'runtimeMs':rt,'runtimeMinMs':rt,'runtimeMaxMs':rt,'repeats':1,'output':str(dst.relative_to(out)),'command':'browser Stitch 360'})
  if 'ffmpeg' in requested:
   dst=outputs/f"{item['id']}__ffmpeg.png"
   try:
    t,cmd=run_ffmpeg(raw,dst,W,H,fov,args.repeats,args.warmup,args.ffmpeg_bin,args.ffmpeg_interp);med,lo,hi=summarize_timings(t);m=real_metrics(dst,seam);results.append({**base,'method':'ffmpeg_v360','status':'ok',**m,'runtimeMs':med,'runtimeMinMs':lo,'runtimeMaxMs':hi,'repeats':len(t),'output':str(dst.relative_to(out)),'command':cmd});commands.append(f"{item['id']}\tFFmpeg\t{cmd}")
   except FileNotFoundError as e:
    if args.strict_missing_tools:raise
    results.append({**base,'method':'ffmpeg_v360','status':f'skipped: {e}','seamLumaJump':math.nan,'seamRgbJump':math.nan,'seamGradientRatio':math.nan,'seamRgbRatio':math.nan,'horizontalTV':math.nan,'laplacianVariance':math.nan,'meanLuma':math.nan,'runtimeMs':math.nan,'runtimeMinMs':math.nan,'runtimeMaxMs':math.nan,'repeats':0,'output':'','command':''})
  if 'hugin' in requested:
   dst=outputs/f"{item['id']}__hugin.png"
   try:
    t,cmd=run_hugin(raw,dst,W,H,fov,args.repeats,args.warmup);med,lo,hi=summarize_timings(t);m=real_metrics(dst,seam);results.append({**base,'method':'hugin_known_geometry','status':'ok',**m,'runtimeMs':med,'runtimeMinMs':lo,'runtimeMaxMs':hi,'repeats':len(t),'output':str(dst.relative_to(out)),'command':cmd});commands.append(f"{item['id']}\tHugin\t{cmd}")
   except FileNotFoundError as e:
    if args.strict_missing_tools:raise
    results.append({**base,'method':'hugin_known_geometry','status':f'skipped: {e}','seamLumaJump':math.nan,'seamRgbJump':math.nan,'seamGradientRatio':math.nan,'seamRgbRatio':math.nan,'horizontalTV':math.nan,'laplacianVariance':math.nan,'meanLuma':math.nan,'runtimeMs':math.nan,'runtimeMinMs':math.nan,'runtimeMaxMs':math.nan,'repeats':0,'output':'','command':''})
 write_csv(out/'real_camera_raw.csv',results);(out/'commands.log').write_text('\n'.join(commands)+('\n' if commands else ''),encoding='utf-8');(out/'REAL_BENCHMARK_RUN.json').write_text(json.dumps({'bundle':str(bundle),'methods':sorted(requested),'rows':len(results),'successfulRows':sum(r['status']=='ok' for r in results),'note':'No-reference seam metrics are diagnostic proxies, not ground-truth quality scores. Pair them with blinded human ratings.'},indent=2),encoding='utf-8');print(f"Wrote {out/'real_camera_raw.csv'}")
if __name__=='__main__':raise SystemExit(main())
