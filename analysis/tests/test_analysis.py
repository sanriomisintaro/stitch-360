import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from stitch360_analysis import (
    AnalysisConfig,
    bootstrap_mean_ci,
    classify_condition,
    cliff_delta,
    holm_adjust,
    paired_rank_biserial,
    paired_wilcoxon,
    summarize_metric_groups,
)


class TestAnalysisHelpers(unittest.TestCase):
    def test_condition_classification(self):
        self.assertEqual(classify_condition(1.0, 0.0), "C0 Clean")
        self.assertEqual(classify_condition(1.05, 0.0), "C1 Photometric")
        self.assertEqual(classify_condition(1.0, 1.0), "C2 Calibration")
        self.assertEqual(classify_condition(1.05, 1.0), "C3 Combined")

    def test_bootstrap_deterministic(self):
        a = bootstrap_mean_ci([1, 2, 3, 4, 5], resamples=500, seed=360)
        b = bootstrap_mean_ci([1, 2, 3, 4, 5], resamples=500, seed=360)
        self.assertEqual(a, b)
        self.assertLessEqual(a[0], 3.0)
        self.assertGreaterEqual(a[1], 3.0)

    def test_holm_adjust(self):
        out = holm_adjust([0.01, 0.04, 0.03])
        self.assertEqual(len(out), 3)
        for raw, adj in zip([0.01, 0.04, 0.03], out):
            self.assertGreaterEqual(adj + 1e-12, raw)
            self.assertLessEqual(adj, 1.0)

    def test_cliff_delta_direction(self):
        self.assertEqual(cliff_delta([3, 4], [1, 2]), 1.0)
        self.assertEqual(cliff_delta([1, 2], [3, 4]), -1.0)
        self.assertEqual(cliff_delta([1, 2], [1, 2]), 0.0)

    def test_paired_rank_biserial(self):
        self.assertAlmostEqual(paired_rank_biserial([3, 4, 5], [1, 2, 3]), 1.0)
        self.assertAlmostEqual(paired_rank_biserial([1, 2, 3], [3, 4, 5]), -1.0)

    def test_wilcoxon_identical(self):
        w, p = paired_wilcoxon(np.array([1, 2, 3]), np.array([1, 2, 3]))
        self.assertEqual(w, 0.0)
        self.assertEqual(p, 1.0)

    def test_summary_shape(self):
        df = pd.DataFrame({
            "condition": ["C0 Clean"] * 6,
            "gamma": [1, 1, 1, 2, 2, 2],
            "psnr": [30, 31, 32, 33, 34, 35],
        })
        cfg = AnalysisConfig(bootstrap_resamples=100, seed=1)
        out = summarize_metric_groups(df, ["psnr"], cfg)
        self.assertEqual(len(out), 2)
        self.assertEqual(set(out["gamma"]), {1.0, 2.0})


if __name__ == "__main__":
    unittest.main()
