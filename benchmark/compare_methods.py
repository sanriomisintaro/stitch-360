#!/usr/bin/env python3
"""Publication-oriented method comparison for Sprint 5 baseline_raw.csv."""
from __future__ import annotations
import argparse, json, math
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.stats import friedmanchisquare, wilcoxon

METRICS = ["psnr", "ssim", "mae", "seamPsnr", "seamSsim", "seamMae", "seamGradientError", "runtimeMs"]
HIGHER = {"psnr", "ssim", "seamPsnr", "seamSsim"}


def bootstrap_ci(values, n=10000, seed=360):
    x=np.asarray(values,float); x=x[np.isfinite(x)]
    if len(x)==0:return math.nan,math.nan
    if len(x)==1:return float(x[0]),float(x[0])
    rng=np.random.default_rng(seed); means=x[rng.integers(0,len(x),size=(n,len(x)))].mean(axis=1)
    return tuple(map(float,np.quantile(means,[.025,.975])))


def holm(ps):
    p=np.asarray(ps,float); m=len(p); out=np.empty(m,float); order=np.argsort(p); running=0
    vals=np.empty(m,float)
    for rank,idx in enumerate(order): running=max(running,(m-rank)*p[idx]); vals[rank]=min(1,running)
    for rank,idx in enumerate(order): out[idx]=vals[rank]
    return out.tolist()


def paired_rbc(x,y):
    d=np.asarray(x,float)-np.asarray(y,float); d=d[np.isfinite(d)]; d=d[d!=0]
    if not len(d): return 0.0
    a=np.abs(d); order=np.argsort(a); ranks=np.empty(len(d),float); i=0; rank=1
    while i<len(d):
        j=i+1
        while j<len(d) and a[order[j]]==a[order[i]]: j+=1
        ranks[order[i:j]]=(rank+rank+(j-i)-1)/2; rank+=j-i; i=j
    pos=ranks[d>0].sum(); neg=ranks[d<0].sum(); return float((pos-neg)/(pos+neg)) if pos+neg else 0


def paired(df, metric, a, b):
    aa=df[df.method==a][["id",metric]].rename(columns={metric:"a"}); bb=df[df.method==b][["id",metric]].rename(columns={metric:"b"})
    p=aa.merge(bb,on="id").dropna(); return p.a.to_numpy(float),p.b.to_numpy(float)


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--input",type=Path,required=True); ap.add_argument("--out",type=Path,default=Path("method-comparison")); ap.add_argument("--bootstrap",type=int,default=10000); ap.add_argument("--reference",default="stitch360")
    args=ap.parse_args(); out=args.out; out.mkdir(parents=True,exist_ok=True)
    df=pd.read_csv(args.input); df=df[df.status=="ok"].copy()
    for m in METRICS: df[m]=pd.to_numeric(df[m],errors="coerce")
    summary=[]
    for (condition,method),g in df.groupby(["condition","method"],sort=True):
        for metric in METRICS:
            v=g[metric].to_numpy(float); v=v[np.isfinite(v)]; lo,hi=bootstrap_ci(v,args.bootstrap,360+sum(map(ord,method+metric)))
            summary.append({"condition":condition,"method":method,"metric":metric,"n":len(v),"mean":np.mean(v) if len(v) else math.nan,"sd":np.std(v,ddof=1) if len(v)>1 else math.nan,"median":np.median(v) if len(v) else math.nan,"ci95_low":lo,"ci95_high":hi})
    summary_df=pd.DataFrame(summary)
    summary_df.to_csv(out/"method_summary_bootstrap.csv",index=False)
    # Compact manuscript-facing table (mean ± SD) while preserving raw summary separately.
    compact=[]
    for (condition,method),g in df.groupby(["condition","method"],sort=True):
        row={"condition":condition,"method":method,"n":int(g["id"].nunique())}
        for metric in ["psnr","ssim","seamPsnr","seamSsim","seamGradientError","runtimeMs"]:
            v=g[metric].dropna().to_numpy(float)
            row[f"{metric}_mean"]=float(np.mean(v)) if len(v) else math.nan
            row[f"{metric}_sd"]=float(np.std(v,ddof=1)) if len(v)>1 else math.nan
        compact.append(row)
    pd.DataFrame(compact).to_csv(out/"table5_method_comparison.csv",index=False)

    omnibus=[]; pairrows=[]
    for condition,g in df.groupby("condition",sort=True):
        methods=sorted(g.method.unique())
        for metric in METRICS:
            wide=g.pivot_table(index="id",columns="method",values=metric,aggfunc="first").dropna()
            if len(methods)>=3 and all(m in wide for m in methods) and len(wide)>=2:
                stat,p=friedmanchisquare(*(wide[m].to_numpy(float) for m in methods)); omnibus.append({"condition":condition,"metric":metric,"n":len(wide),"methods":"|".join(methods),"friedman_chi2":stat,"p":p})
            if args.reference not in methods: continue
            tmp=[]
            for other in methods:
                if other==args.reference: continue
                x,y=paired(g,metric,args.reference,other)
                if not len(x): continue
                if np.allclose(x-y,0): stat,p=0.0,1.0
                else:
                    r=wilcoxon(x,y,zero_method="wilcox",alternative="two-sided",method="auto"); stat,p=float(r.statistic),float(r.pvalue)
                tmp.append({"condition":condition,"metric":metric,"method_a":args.reference,"method_b":other,"n":len(x),"mean_diff_a_minus_b":float(np.mean(x-y)),"wilcoxon_W":stat,"p_raw":p,"rank_biserial":paired_rbc(x,y)})
            if tmp:
                adj=holm([r["p_raw"] for r in tmp])
                for r,padj in zip(tmp,adj): r["p_holm"]=padj; pairrows.append(r)
    pd.DataFrame(omnibus).to_csv(out/"method_friedman.csv",index=False)
    pd.DataFrame(pairrows).to_csv(out/"method_pairwise_wilcoxon_holm.csv",index=False)

    # Condition-specific plots avoid conflating perturbation regimes.
    for condition,cdf in df.groupby("condition",sort=True):
        slug="".join(ch.lower() if ch.isalnum() else "_" for ch in condition).strip("_")
        for metric in ["psnr","ssim","seamPsnr","seamSsim","runtimeMs"]:
            fig,ax=plt.subplots(figsize=(7.2,4.5))
            groups=[]; labels=[]
            for method in sorted(cdf.method.unique()):
                vals=cdf[cdf.method==method][metric].dropna().to_numpy(float)
                if len(vals): groups.append(vals); labels.append(method)
            if groups:
                ax.boxplot(groups,tick_labels=labels,showmeans=True)
                ax.set_ylabel(metric); ax.set_xlabel("Method"); ax.set_title(f"{metric} by method — {condition}")
                ax.tick_params(axis='x',rotation=15); fig.tight_layout(); fig.savefig(out/f"figure_{slug}_{metric}.png",dpi=300); plt.close(fig)
    (out/"METHOD_COMPARISON_RUN.json").write_text(json.dumps({"input":str(args.input),"reference":args.reference,"bootstrap":args.bootstrap,"methods":sorted(df.method.unique()),"conditions":sorted(df.condition.unique())},indent=2),encoding="utf-8")
    print(f"Wrote method-comparison outputs to {out}")

if __name__=="__main__": main()
