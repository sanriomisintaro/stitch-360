import csv, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class CompareMethodsTests(unittest.TestCase):
    def test_compare_methods_end_to_end(self):
        with tempfile.TemporaryDirectory() as td:
            td=Path(td); inp=td/'raw.csv'; out=td/'out'
            fields=['id','image','condition','method','status','psnr','ssim','mae','seamPsnr','seamSsim','seamMae','seamGradientError','runtimeMs']
            methods=['stitch360','ffmpeg_v360','hugin_known_geometry']
            with inp.open('w',newline='',encoding='utf-8') as fh:
                w=csv.DictWriter(fh,fieldnames=fields); w.writeheader()
                for i in range(1,6):
                    for j,m in enumerate(methods):
                        w.writerow({'id':f'I{i}','image':f'i{i}.png','condition':'C0 Clean','method':m,'status':'ok',
                                    'psnr':30-j+i*.1,'ssim':.95-j*.01+i*.001,'mae':3+j,
                                    'seamPsnr':28-j+i*.1,'seamSsim':.92-j*.01,'seamMae':4+j,
                                    'seamGradientError':1+j*.1,'runtimeMs':100+j*50+i})
            p=subprocess.run([sys.executable,str(ROOT/'compare_methods.py'),'--input',str(inp),'--out',str(out),'--bootstrap','100'],capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
            self.assertTrue((out/'method_summary_bootstrap.csv').exists())
            self.assertTrue((out/'method_pairwise_wilcoxon_holm.csv').exists())
            self.assertTrue((out/'method_friedman.csv').exists())

if __name__=='__main__': unittest.main()
