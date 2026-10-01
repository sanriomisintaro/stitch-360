#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REQUIRED=[
 'README.md','LICENSE','CITATION.cff','CHANGELOG.md','RELEASE_NOTES_v1.0.0.md','package.json','requirements.txt',
 'docs/index.html','docs/core/projection.js','docs/core/sampling.js','docs/core/blending.js','docs/core/stitcher-core.js','docs/core/synthetic-generator.js','docs/core/metrics.js',
 'analysis/stitch360_analysis.py','benchmark/baseline_benchmark.py','benchmark/real_camera_benchmark.py',
 'research/FINAL_STUDY_DESIGN.md','research/DATA_DICTIONARY_FINAL.md','research/REPRODUCIBILITY_CHECKLIST.md','research/REAL_CAMERA_DATASET_METADATA.csv','research/calibration/CAL-REAL-01.json',
 'data/synthetic/fixtures/PILOT_FIXTURE_001_gradient.png','data/synthetic/fixtures/PILOT_FIXTURE_006_mixed.png',
 'results/published/table5_synthetic_gamma2_summary.csv','results/published/table8_real_camera_ffmpeg_comparison.csv','results/published/table9_runtime_scaling_summary.csv',
 '.github/workflows/tests.yml','UPLOAD_TO_GITHUB.md'
]
def sha256(p):
 h=hashlib.sha256();
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
 return h.hexdigest()
def main():
 missing=[x for x in REQUIRED if not (ROOT/x).is_file()]
 if missing:
  print('Missing required files:'); [print(' -',x) for x in missing]; return 1
 pkg=json.loads((ROOT/'package.json').read_text())
 if pkg.get('version')!='1.0.0': print('package.json version must be 1.0.0'); return 1
 forbidden=['paper-evergreen','paper']
 for d in forbidden:
  if (ROOT/d).exists(): print('Forbidden submission/manuscript directory present:',d); return 1
 files=[p for p in ROOT.rglob('*') if p.is_file() and p.name!='RELEASE_MANIFEST.sha256' and '.git' not in p.parts]
 lines=[f"{sha256(p)}  {p.relative_to(ROOT).as_posix()}" for p in sorted(files)]
 (ROOT/'RELEASE_MANIFEST.sha256').write_text('\n'.join(lines)+'\n')
 print(f'Release structure OK ({len(files)} files).')
 print('Wrote RELEASE_MANIFEST.sha256')
 return 0
if __name__=='__main__': raise SystemExit(main())
