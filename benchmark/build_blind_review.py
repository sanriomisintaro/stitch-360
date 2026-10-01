#!/usr/bin/env python3
"""Build a deterministic blinded visual-review packet from Sprint 6 outputs."""
from __future__ import annotations
import argparse,csv,json,random,shutil
from pathlib import Path
from PIL import Image

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--benchmark-dir',type=Path,required=True);ap.add_argument('--out',type=Path,default=Path('blind-review'));ap.add_argument('--seed',type=int,default=360);ap.add_argument('--crop-deg',type=float,default=24);args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True);imgout=args.out/'images';imgout.mkdir(exist_ok=True)
 rows=list(csv.DictReader((args.benchmark_dir/'real_camera_raw.csv').open(encoding='utf-8-sig')));rows=[r for r in rows if r['status']=='ok'];rng=random.Random(args.seed);by={}
 for r in rows:by.setdefault(r['id'],[]).append(r)
 key=[];trials=[]
 for sid,items in sorted(by.items()):
  shuffled=items[:];rng.shuffle(shuffled)
  for n,r in enumerate(shuffled):
   code=chr(ord('A')+n);src=args.benchmark_dir/r['output'];im=Image.open(src).convert('RGB');w,h=im.size;cropw=max(32,int(w*args.crop_deg/360));
   full=im.copy();full.thumbnail((1000,500));fulln=f'{sid}__{code}__full.jpg';full.save(imgout/fulln,quality=92)
   crops=[]
   for j,c in enumerate([int(w*.25),int(w*.75)],1):
    x0=max(0,c-cropw//2);x1=min(w,c+cropw//2);cr=im.crop((x0,0,x1,h));cr=cr.resize((cr.width*2,cr.height*2));name=f'{sid}__{code}__seam{j}.jpg';cr.save(imgout/name,quality=95);crops.append(name)
   key.append({'scene_id':sid,'blind_code':code,'method':r['method']});trials.append({'scene_id':sid,'blind_code':code,'full':fulln,'seam1':crops[0],'seam2':crops[1]})
 with (args.out/'blind_key.csv').open('w',newline='',encoding='utf-8') as f:w=csv.DictWriter(f,fieldnames=key[0]);w.writeheader();w.writerows(key)
 with (args.out/'review_trials.csv').open('w',newline='',encoding='utf-8') as f:w=csv.DictWriter(f,fieldnames=trials[0]);w.writeheader();w.writerows(trials)
 data=json.dumps(trials)
 html=f'''<!doctype html><meta charset="utf-8"><title>Stitch 360 blinded review</title><style>body{{font:16px system-ui;max-width:1100px;margin:auto;padding:20px}}img{{max-width:100%;border:1px solid #ccc}}.trial{{border-top:1px solid #aaa;padding:18px 0}}label{{margin-right:18px}}select{{margin-left:5px}}</style><h1>Blinded panorama quality review</h1><p>Rate each anonymized output independently. 1 = very poor / highly visible artifact; 5 = excellent / artifact not noticeable.</p><div id="app"></div><button id="save">Download ratings CSV</button><script>const trials={data};const app=document.getElementById('app');for(const t of trials){{const d=document.createElement('div');d.className='trial';d.innerHTML=`<h2>${{t.scene_id}} — ${{t.blind_code}}</h2><img src="images/${{t.full}}"><div><img src="images/${{t.seam1}}"><img src="images/${{t.seam2}}"></div><label>Seam visibility <select data-k="seam"><option></option>${{[1,2,3,4,5].map(x=>`<option>${{x}}</option>`).join('')}}</select></label><label>Ghosting <select data-k="ghost"><option></option>${{[1,2,3,4,5].map(x=>`<option>${{x}}</option>`).join('')}}</select></label><label>Geometric quality <select data-k="geom"><option></option>${{[1,2,3,4,5].map(x=>`<option>${{x}}</option>`).join('')}}</select></label><label>Overall quality <select data-k="overall"><option></option>${{[1,2,3,4,5].map(x=>`<option>${{x}}</option>`).join('')}}</select></label>`;d.dataset.scene=t.scene_id;d.dataset.code=t.blind_code;app.appendChild(d);}}document.getElementById('save').onclick=()=>{{const rows=[['scene_id','blind_code','seam_visibility','ghosting','geometric_quality','overall_quality']];for(const d of document.querySelectorAll('.trial')){{const s=[...d.querySelectorAll('select')].map(x=>x.value);rows.push([d.dataset.scene,d.dataset.code,...s]);}}const csv=rows.map(r=>r.join(',')).join('\n');const b=new Blob([csv],{{type:'text/csv'}}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='reviewer_ratings.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}};</script>'''
 (args.out/'review.html').write_text(html,encoding='utf-8');(args.out/'README.txt').write_text('Open review.html in a browser. Keep blind_key.csv hidden from reviewers. Merge ratings only after collection.\n',encoding='utf-8');print(f'Wrote blinded review packet to {args.out}')
if __name__=='__main__':main()
