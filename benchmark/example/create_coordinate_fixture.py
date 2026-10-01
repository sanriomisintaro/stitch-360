#!/usr/bin/env python3
"""Create a tiny deterministic Sprint 5 coordinate-pattern baseline fixture.

This fixture is for pipeline verification only, never for scientific results.
"""
from __future__ import annotations
import csv, math
from pathlib import Path
import numpy as np
from PIL import Image


def make_gt(width=512, height=256):
    x=np.arange(width)[None,:]; y=np.arange(height)[:,None]
    r=np.broadcast_to(np.round(255*x/(width-1)),(height,width))
    g=np.broadcast_to(np.round(255*y/(height-1)),(height,width))
    b=(np.broadcast_to((x//32)%2,(height,width))*127 + np.broadcast_to((y//32)%2,(height,width))*128)%256
    return np.stack([r,g,b],axis=-1).astype(np.uint8)


def sample_nearest_wrapped(img, x, y):
    h,w,_=img.shape
    return img[max(0,min(h-1,int(round(y)))), int(round(x))%w]


def make_dual(gt, fov=200.0, radius_scale=.985):
    h,w,_=gt.shape; out=np.zeros_like(gt)
    radius=min(w*.25,h*.5)*radius_scale; half=math.radians(fov)/2; f=radius/half
    centers=[(w*.25,h*.5,False),(w*.75,h*.5,True)]
    for sy in range(h):
        for sx in range(w):
            hits=[]
            for cx,cy,right in centers:
                dx=sx-cx; dy=sy-cy
                if dx*dx+dy*dy<=radius*radius: hits.append((dx*dx+dy*dy,cx,cy,right))
            if not hits: continue
            _,cx,cy,right=min(hits)
            dx=sx-cx; dy=sy-cy; rr=math.hypot(dx,dy); theta=rr/f
            if theta>half: continue
            if rr==0:
                vx,vy,vz=(1,0,0) if right else (-1,0,0)
            else:
                az=math.atan2(dx,-dy); st=math.sin(theta); ct=math.cos(theta)
                if right: vx,vy,vz=ct,st*math.sin(az),st*math.cos(az)
                else: vx,vy,vz=-ct,-st*math.sin(az),st*math.cos(az)
            lon=math.atan2(vy,vx); lat=math.asin(max(-1,min(1,vz)))
            px=((lon+math.pi)/(2*math.pi))*w; py=((lat+math.pi/2)/math.pi)*h
            out[sy,sx]=sample_nearest_wrapped(gt,px,py)
    return out


def main():
    root=Path(__file__).resolve().parent/"demo_bundle"
    p=root/"images"/"001_coordinate"; p.mkdir(parents=True,exist_ok=True)
    gt=make_gt(); dual=make_dual(gt)
    Image.fromarray(gt).save(p/"ground_truth.png"); Image.fromarray(dual).save(p/"dual_fisheye.png")
    # A placeholder is deliberately not created for Stitch 360; run the browser exporter for real comparison studies.
    with (root/"manifest.csv").open("w",newline="",encoding="utf-8") as fh:
        field=["id","image","width","height","fovDeg","radiusScale","gamma","rightLensGain","generatorFovDelta","seamHalfWidthDeg","groundTruth","dualFisheye","stitch360"]
        w=csv.DictWriter(fh,fieldnames=field); w.writeheader(); w.writerow({"id":"001_coordinate","image":"coordinate_fixture.png","width":512,"height":256,"fovDeg":200,"radiusScale":.985,"gamma":2,"rightLensGain":1,"generatorFovDelta":0,"seamHalfWidthDeg":10,"groundTruth":"images/001_coordinate/ground_truth.png","dualFisheye":"images/001_coordinate/dual_fisheye.png","stitch360":"images/001_coordinate/stitch360.png"})
    (root/"README.txt").write_text("PIPELINE FIXTURE ONLY. This coordinate-pattern bundle is not scientific evidence. Run baseline_benchmark.py with --methods ffmpeg to verify FFmpeg integration.\n",encoding="utf-8")
    print(root)

if __name__=="__main__": main()
