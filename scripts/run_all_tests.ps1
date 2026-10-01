$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
Write-Host "+ npm test"
npm test
Write-Host "+ python -m pytest -q analysis/tests benchmark/tests tests/test_real_camera_metrics.py"
python -m pytest -q analysis/tests benchmark/tests tests/test_real_camera_metrics.py
Write-Host "All Stitch 360 release tests passed."
