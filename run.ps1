# Builds what is missing and starts the app on http://127.0.0.1:8765 (Windows).
# Usage: .\run.ps1 [--port 8765] [--no-browser]   or double-click run.cmd
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Fail($message) { Write-Host "ERROR: $message" -ForegroundColor Red; exit 1 }
function Check($what) { if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE)." } }

$venvPython = "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    if (Get-Command py -ErrorAction SilentlyContinue) { $pyExe = "py"; $pyArgs = @("-3") }
    elseif (Get-Command python -ErrorAction SilentlyContinue) { $pyExe = "python"; $pyArgs = @() }
    else { Fail "Python not found. Install Python 3.10+ (see docs\INSTALL.md)." }
    & $pyExe @pyArgs -c "import sys; sys.exit(sys.version_info < (3, 10))"
    if ($LASTEXITCODE -ne 0) { Fail "Python 3.10+ is required." }
    & $pyExe @pyArgs -m venv backend\.venv; Check "Creating the virtualenv"
    & $venvPython -m pip install -q --upgrade pip; Check "Upgrading pip"
    & $venvPython -m pip install -q -e backend; Check "Installing the backend"
}

$dist = "frontend\dist\index.html"
$stale = -not (Test-Path $dist)
if (-not $stale) {
    $built = (Get-Item $dist).LastWriteTime
    $stale = [bool](Get-ChildItem frontend\src -Recurse -File | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1)
}
if ($stale) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js not found. Install Node.js 22.12+ (see docs\INSTALL.md)." }
    $v = (node -p "process.versions.node").Split(".") | ForEach-Object { [int]$_ }
    if ($v[0] -lt 22 -or ($v[0] -eq 22 -and $v[1] -lt 12)) { Fail "Node.js 22.12+ is required, found $(node --version)." }
    Push-Location frontend
    try {
        # npm.cmd, not npm: the npm.ps1 shim is blocked by the default execution policy.
        if (-not (Test-Path node_modules)) { npm.cmd ci; Check "npm ci" }
        npm.cmd run build; Check "Building the frontend"
    } finally { Pop-Location }
}

& $venvPython -m jtt @args
