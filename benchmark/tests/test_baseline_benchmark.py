import math, shutil, subprocess, tempfile, unittest
from pathlib import Path
import sys
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import baseline_benchmark as bb

class BaselineTests(unittest.TestCase):
    def test_condition_labels(self):
        self.assertEqual(bb.classify_condition(1,0),"C0 Clean")
        self.assertEqual(bb.classify_condition(1.05,0),"C1 Photometric")
        self.assertEqual(bb.classify_condition(1,1),"C2 Calibration")
        self.assertEqual(bb.classify_condition(1.05,1),"C3 Combined")

    def test_identical_metrics(self):
        with tempfile.TemporaryDirectory() as td:
            a=np.zeros((16,32,3),dtype=np.uint8); a[...,0]=100; a[...,1]=50
            p=Path(td)/"a.png"; Image.fromarray(a).save(p)
            m=bb.compute_metrics(p,p,10)
            self.assertEqual(m["mse"],0)
            self.assertTrue(math.isinf(m["psnr"]))
            self.assertAlmostEqual(m["ssim"],1,places=12)
            self.assertAlmostEqual(m["seamSsim"],1,places=12)

    def test_ffmpeg_command(self):
        c=bb.build_ffmpeg_command("ffmpeg",Path("in.png"),Path("out.png"),1024,512,200,"linear")
        s=" ".join(map(str,c))
        self.assertIn("input=dfisheye",s); self.assertIn("output=equirect",s); self.assertIn("ih_fov=200",s)

    @unittest.skipUnless(shutil.which("ffmpeg"),"FFmpeg not installed")
    def test_ffmpeg_fixture_integration(self):
        script=ROOT/"example"/"create_coordinate_fixture.py"
        subprocess.run([sys.executable,str(script)],check=True,capture_output=True,text=True)
        bundle=ROOT/"example"/"demo_bundle"; row=bb.read_manifest(bundle)[0]
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/"ff.png"
            times,_=bb.run_ffmpeg(bundle/row["dualFisheye"],out,512,256,200,1,0,"ffmpeg","linear")
            self.assertTrue(out.exists()); self.assertEqual(len(times),1)
            m=bb.compute_metrics(bundle/row["groundTruth"],out,10)
            self.assertGreater(m["psnr"],20)

if __name__=="__main__": unittest.main()
