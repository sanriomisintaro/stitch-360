from pathlib import Path
import importlib.util,sys,tempfile
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('rcb',ROOT/'benchmark'/'real_camera_benchmark.py');m=importlib.util.module_from_spec(spec);sys.path.insert(0,str(ROOT/'benchmark'));spec.loader.exec_module(m)

def save(a,p):Image.fromarray(a.astype(np.uint8),'RGB').save(p)
def test_seam_metric_detects_inserted_jump():
 with tempfile.TemporaryDirectory() as td:
  td=Path(td);h,w=64,128
  x=np.linspace(20,220,w,dtype=np.float64)[None,:,None];a=np.repeat(np.repeat(x,h,axis=0),3,axis=2)
  p1=td/'smooth.png';save(a,p1);b=a.copy();b[:,w//4:,:]+=25;b=np.clip(b,0,255);p2=td/'jump.png';save(b,p2)
  q1=m.real_metrics(p1,10);q2=m.real_metrics(p2,10)
  assert q2['seamLumaJump']>q1['seamLumaJump']
  assert q2['seamGradientRatio']>q1['seamGradientRatio']

def test_seam_columns():
 assert m.seam_columns(400)==[100,300]
