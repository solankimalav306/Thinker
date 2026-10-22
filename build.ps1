# ============================================================
#  Thinker - Master Build Script
#  Usage:
#    .\build.ps1                     # full build (backend + installer)
#    .\build.ps1 -SkipBackend        # skip PyInstaller, reuse existing backend.exe
#    .\build.ps1 -BumpVersion minor  # bump version in package.json before building
# ============================================================

param(
    [switch]$SkipBackend,
    [ValidateSet('major', 'minor', 'patch', '')]
    [string]$BumpVersion = ''
)

$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot

# -- Helpers ------------------------------------------------------------------
function Write-Step($n, $msg) {
    Write-Host ""
    Write-Host "  [$n] $msg" -ForegroundColor Cyan
}

function Write-OK($msg)   { Write-Host "      OK  $msg" -ForegroundColor Green  }
function Write-Warn($msg) { Write-Host "      !!  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "      XX  $msg" -ForegroundColor Red; exit 1 }

function Invoke-Cmd($cmd) {
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) { Write-Fail "Command failed: $cmd" }
}

# -- Banner -------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Magenta
Write-Host "   Thinker -- Release Build Pipeline"         -ForegroundColor Magenta
Write-Host "  ============================================" -ForegroundColor Magenta

# -- 0. Read current version --------------------------------------------------
$pkgJson    = Join-Path $RootDir "package.json"
$pkg        = Get-Content $pkgJson -Raw | ConvertFrom-Json
$currentVer = $pkg.version
Write-Host ""
Write-Host "  Current version : $currentVer" -ForegroundColor Gray

# -- 1. Optional version bump -------------------------------------------------
if ($BumpVersion -ne '') {
    Write-Step "1" "Bumping $BumpVersion version..."

    $parts = $currentVer -split '\.'
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    switch ($BumpVersion) {
        'major' { $major++; $minor = 0; $patch = 0 }
        'minor' { $minor++;             $patch = 0 }
        'patch' { $patch++ }
    }

    $newVer  = "$major.$minor.$patch"
    $rawJson = Get-Content $pkgJson -Raw
    $rawJson = $rawJson -replace '"version"\s*:\s*"[^"]+"', ('"version": "' + $newVer + '"')
    [System.IO.File]::WriteAllText($pkgJson, $rawJson, [System.Text.UTF8Encoding]::new($false))

    Write-OK "Version bumped: $currentVer -> $newVer"
    $currentVer = $newVer
} else {
    Write-Step "1" "Version bump skipped (current: $currentVer)"
    Write-OK "Using version $currentVer"
}

# -- 2. Compile Python backend -> backend.exe ---------------------------------
if ($SkipBackend) {
    Write-Step "2" "Backend compilation skipped (-SkipBackend flag)"
    if (-not (Test-Path (Join-Path $RootDir "backend.exe"))) {
        Write-Fail "backend.exe not found. Remove -SkipBackend or run a full build first."
    }
    Write-OK "Reusing existing backend.exe"
} else {
    Write-Step "2" "Compiling Python backend with PyInstaller..."

    $venvPy          = Join-Path $RootDir "venv\Scripts\python.exe"
    $venvPyInstaller = Join-Path $RootDir "venv\Scripts\pyinstaller.exe"

    if (-not (Test-Path $venvPy)) {
        Write-Fail 'Virtual environment not found at .\venv\  Create it with: python -m venv venv  then: pip install -r agent-handler\requirements.txt pyinstaller'
    }

    if (-not (Test-Path $venvPyInstaller)) {
        Write-Warn "pyinstaller not found in venv, installing..."
        & $venvPy -m pip install pyinstaller --quiet
        if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to install PyInstaller." }
        Write-OK "PyInstaller installed"
    }

    $buildDir = Join-Path $RootDir "build"
    $distDir  = Join-Path $RootDir "dist"
    $rootExe  = Join-Path $RootDir "backend.exe"

    Write-Host "      Cleaning PyInstaller work directory..." -ForegroundColor Gray
    if (Test-Path $buildDir) { Remove-Item $buildDir -Recurse -Force }
    if (Test-Path $rootExe)  { Remove-Item $rootExe  -Force }

    # PyInstaller 6.x does not always pre-create its own work subdirectory,
    # causing a FileNotFoundError when writing base_library.zip. Create it first.
    New-Item -ItemType Directory -Path (Join-Path $buildDir "backend") -Force | Out-Null

    Write-Host "      Running PyInstaller..." -ForegroundColor Gray
    Set-Location $RootDir
    & $venvPyInstaller backend.spec --noconfirm
    if ($LASTEXITCODE -ne 0) { Write-Fail "PyInstaller failed. Check errors above." }

    # One-file mode -> dist\backend.exe
    # One-dir  mode -> dist\backend\backend.exe  (not supported, must use one-file)
    $specDist1 = Join-Path $distDir "backend.exe"
    $specDist2 = Join-Path $distDir "backend\backend.exe"

    if (Test-Path $specDist1) {
        Move-Item $specDist1 $rootExe -Force
    } elseif (Test-Path $specDist2) {
        Write-Fail "PyInstaller ran in one-dir mode. backend.spec must use one-file mode (no COLLECT block)."
    } else {
        Write-Fail "backend.exe not found after PyInstaller. Check backend.spec."
    }

    Write-OK "backend.exe compiled and placed in project root"

    # Clean PyInstaller work dirs; leave dist/ for electron-builder output
    if (Test-Path $buildDir) { Remove-Item $buildDir -Recurse -Force }
    $pyiSub = Join-Path $distDir "backend"
    if (Test-Path $pyiSub) { Remove-Item $pyiSub -Recurse -Force }
    Write-OK "PyInstaller work directories cleaned"

    Set-Location $RootDir
}

# -- 3. Check node_modules ----------------------------------------------------
Write-Step "3" "Checking Node dependencies..."
$nodeModules = Join-Path $RootDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Warn "node_modules not found -- running npm install..."
    Set-Location $RootDir
    Invoke-Cmd "npm install"
    Write-OK "npm install complete"
} else {
    Write-OK "node_modules present"
}

# -- 4. Package with electron-builder -----------------------------------------
Write-Step "4" "Packaging Electron app (NSIS installer, Windows x64)..."

Set-Location $RootDir
Invoke-Cmd "npm run build"

Write-OK "Electron packaging complete"

# -- 5. Report output installer -----------------------------------------------
Write-Step "5" "Locating installer..."

$installerDir = Join-Path $RootDir "dist"
$installer = Get-ChildItem $installerDir -Filter "*.exe" -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -notlike "backend*" } |
             Sort-Object LastWriteTime -Descending |
             Select-Object -First 1

if ($null -ne $installer) {
    $sizeMB = [math]::Round($installer.Length / 1MB, 1)
    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor Green
    Write-Host "   BUILD SUCCESSFUL"                                             -ForegroundColor Green
    Write-Host "  ============================================================" -ForegroundColor Green
    Write-Host "   Version   : $currentVer"                                     -ForegroundColor Green
    Write-Host "   Installer : $($installer.Name)"                              -ForegroundColor Green
    Write-Host "   Size      : $sizeMB MB"                                      -ForegroundColor Green
    Write-Host "   Path      : $($installer.FullName)"                          -ForegroundColor Green
    Write-Host "  ============================================================" -ForegroundColor Green
} else {
    Write-Warn "Build appears done but no installer .exe found in dist\"
    Write-Warn "Check the dist folder manually."
}

Write-Host ""
