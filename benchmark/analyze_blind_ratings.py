#!/usr/bin/env python3
from __future__ import annotations
import argparse
from pathlib import Path
import pandas as pd,numpy as np
from scipy.stats import friedmanchisquare,wilcoxon

def holm(ps):
 p=np.array(ps,float);m=len(p);o=np.argsort(p);out=np.empty(m);run=0
 for k,i in enumerate(o):run=max(run,(m-k)*p[i]);out[i]=min(1,run)
 return out

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--ratings',type=Path,nargs='+',required=True);ap.add_argument('--key',type=Path,required=True);ap.add_argument('--out',type=Path,default=Path('blind-rating-analysis'));args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True)
 key=pd.read_csv(args.key);frames=[]
 for i,p in enumerate(args.ratings,1):d=pd.read_csv(p);d['reviewer']=i;frames.append(d)
 df=pd.concat(frames,ignore_index=True).merge(key,on=['scene_id','blind_code'],how='left');metrics=['seam_visibility','ghosting','geometric_quality','overall_quality']
 for m in metrics:df[m]=pd.to_numeric(df[m],errors='coerce')
 df.to_csv(args.out/'blind_ratings_unblinded.csv',index=False);df.groupby('method')[metrics].agg(['count','mean','std','median']).to_csv(args.out/'table7_blind_ratings.csv')
 tests=[]
 for met in metrics:
  scene=df.groupby(['reviewer','scene_id','method'])[met].mean().unstack('method').dropna();methods=list(scene.columns)
  if len(methods)>=3 and len(scene)>=2:
   st,p=friedmanchisquare(*(scene[m] for m in methods));tests.append({'metric':met,'test':'Friedman','comparison':'all','stat':st,'p_raw':p})
  if 'stitch360' in methods:
   tmp=[]
   for other in methods:
    if other=='stitch360':continue
    r=wilcoxon(scene['stitch360'],scene[other],method='auto');tmp.append({'metric':met,'test':'Wilcoxon','comparison':f'stitch360 vs {other}','stat':float(r.statistic),'p_raw':float(r.pvalue)})
   if tmp:
    adj=holm([x['p_raw'] for x in tmp])
    for x,p in zip(tmp,adj):x['p_holm']=p;tests.append(x)
 pd.DataFrame(tests).to_csv(args.out/'blind_rating_tests.csv',index=False)
if __name__=='__main__':main()
