# Install project dependencies; do not install or change system tools.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    if (-not (Test-Path 'backend\.venv\Scripts\python.exe')) {
        python -m venv backend\.venv
        if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment creation failed.' }
    }
    & backend\.venv\Scripts\python.exe -m pip --version
    if ($LASTEXITCODE -ne 0) {
        & backend\.venv\Scripts\python.exe -m ensurepip --upgrade
        if ($LASTEXITCODE -ne 0) { throw 'pip setup failed. Check Python permissions.' }
    }
    & backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.in
    if ($LASTEXITCODE -ne 0) { throw 'Backend install failed. Check network, proxy and PIP_NO_INDEX.' }
    & backend\.venv\Scripts\python.exe -m pip check
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency compatibility check failed.' }
    $resolved = & backend\.venv\Scripts\python.exe -m pip freeze
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency lock generation failed.' }
    [System.IO.File]::WriteAllLines((Join-Path $projectRoot 'backend\requirements.lock'), [string[]]$resolved, [System.Text.UTF8Encoding]::new($false))
    & backend\.venv\Scripts\python.exe backend\bootstrap_env.py
    if ($LASTEXITCODE -ne 0) { throw 'Local environment creation failed.' }
    if (-not (Test-Path 'frontend\.env')) { Copy-Item -LiteralPath 'frontend\.env.example' -Destination 'frontend\.env' }
    Push-Location frontend
    try {
        if (Test-Path 'package-lock.json') { npm ci } else { npm install }
        if ($LASTEXITCODE -ne 0) { throw 'Frontend install failed. Check network, proxy and NPM_CONFIG_OFFLINE.' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    } finally { Pop-Location }
    Push-Location flutterapp
    try {
        flutter pub get --enforce-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Flutter install failed. Check Flutter SDK and permissions.' }
        flutter analyze
        if ($LASTEXITCODE -ne 0) { throw 'Flutter analysis failed.' }
    } finally { Pop-Location }
    Write-Host 'Project dependencies installed. See the startup guide in ai_path for starting services.'
} finally { Pop-Location }
