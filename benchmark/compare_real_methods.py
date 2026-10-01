#!/usr/bin/env python3
"""Paired statistical comparison for Sprint 6 real-camera metrics."""
from __future__ import annotations
import argparse,math,json
from pathlib import Path
import numpy as np,pandas as pd,matplotlib.pyplot as plt
from scipy.stats import friedmanchisquare,wilcoxon
METRICS=['seamLumaJump','seamRgbJump','seamGradientRatio','seamRgbRatio','horizontalTV','laplacianVariance','runtimeMs']

def holm(ps):
 p=np.asarray(ps,float);m=len(p);order=np.argsort(p);out=np.empty(m);run=0
 for rank,idx in enumerate(order):run=max(run,(m-rank)*p[idx]);out[idx]=min(1,run)
 return out.tolist()
def rbc(x,y):
 d=np.asarray(x)-np.asarray(y);d=d[np.isfinite(d)];d=d[d!=0]
 if len(d)==0:return 0.0
 a=np.abs(d);o=np.argsort(a);r=np.empty(len(d));i=0;rank=1
 while i<len(d):
  j=i+1
  while j<len(d) and a[o[j]]==a[o[i]]:j+=1
  r[o[i:j]]=(rank+rank+(j-i)-1)/2;rank+=j-i;i=j
 return float((r[d>0].sum()-r[d<0].sum())/r.sum())
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--input',type=Path,required=True);ap.add_argument('--out',type=Path,default=Path('real-method-comparison'));ap.add_argument('--reference',default='stitch360');args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=True);df=pd.read_csv(args.input);df=df[df.status=='ok'].copy()
 summary=df.groupby(['method'])[METRICS].agg(['count','mean','std','median']);summary.to_csv(args.out/'table6_real_camera_summary.csv')
 omnibus=[];pairs=[];methods=sorted(df.method.unique())
 for metric in METRICS:
  wide=df.pivot_table(index='id',columns='method',values=metric,aggfunc='first').dropna()
  if len(methods)>=3 and all(m in wide for m in methods) and len(wide)>=2:
   st,p=friedmanchisquare(*(wide[m] for m in methods));omnibus.append({'metric':metric,'n':len(wide),'friedman_chi2':st,'p':p})
  tmp=[]
  if args.reference in methods:
   for other in methods:
    if other==args.reference:continue
    x=df[df.method==args.reference][['id',metric]].rename(columns={metric:'x'}).merge(df[df.method==other][['id',metric]].rename(columns={metric:'y'}),on='id').dropna()
    if not len(x):continue
    d=x.x.to_numpy()-x.y.to_numpy();res=(0.0,1.0) if np.allclose(d,0) else (lambda q:(float(q.statistic),float(q.pvalue)))(wilcoxon(x.x,x.y,method='auto'))
    tmp.append({'metric':metric,'method_a':args.reference,'method_b':other,'n':len(x),'mean_diff_a_minus_b':float(np.mean(d)),'W':res[0],'p_raw':res[1],'rank_biserial':rbc(x.x,x.y)})
  if tmp:
   adj=holm([q['p_raw'] for q in tmp])
   for q,p in zip(tmp,adj):q['p_holm']=p;pairs.append(q)
 pd.DataFrame(omnibus).to_csv(args.out/'real_friedman.csv',index=False);pd.DataFrame(pairs).to_csv(args.out/'real_pairwise_wilcoxon_holm.csv',index=False)
 for metric in ['seamGradientRatio','seamRgbRatio','runtimeMs']:
  fig,ax=plt.subplots(figsize=(7.2,4.5));groups=[];labels=[]
  for m in methods:
   v=df[df.method==m][metric].dropna().to_numpy();
   if len(v):groups.append(v);labels.append(m)
  if groups:ax.boxplot(groups,tick_labels=labels,showmeans=True);ax.set_ylabel(metric);ax.set_title(f'Real-camera {metric} by method');ax.tick_params(axis='x',rotation=15);fig.tight_layout();fig.savefig(args.out/f'figure_real_{metric}.png',dpi=300);plt.close(fig)
 (args.out/'REAL_COMPARISON_RUN.json').write_text(json.dumps({'input':str(args.input),'reference':args.reference,'methods':methods},indent=2),encoding='utf-8')
if __name__=='__main__':main()
