# Thinker Launch Script (PowerShell)
# Usage: Right-click -> "Run with PowerShell"
#        or from terminal: .\launch.ps1

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Cyan
Write-Host "   Thinker - AI PDF Reader" -ForegroundColor White
Write-Host "   Starting up all services..." -ForegroundColor Gray
Write-Host "  ==========================================" -ForegroundColor Cyan
Write-Host ""

# --- Check venv ---
$venvActivate = Join-Path $RootDir "venv\Scripts\Activate.ps1"
if (-not (Test-Path $venvActivate)) {
    Write-Host "  [ERROR] Virtual environment not found at .\venv\" -ForegroundColor Red
    Write-Host "  Run: python -m venv venv && pip install -r agent-handler\requirements.txt" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# --- Start FastAPI backend in a new window ---
Write-Host "  [1/2] Starting RAG Backend (FastAPI on port 8000)..." -ForegroundColor Green
$backendArgs = "-NoExit -Command `"& '$venvActivate'; Set-Location '$RootDir\agent-handler'; fastapi dev --port 8000`""
$backendProcess = Start-Process powershell -ArgumentList $backendArgs -WindowStyle Minimized -PassThru

# --- Wait for backend to be ready ---
Write-Host "  [   ] Waiting for backend to initialise (4s)..." -ForegroundColor Gray
Start-Sleep -Seconds 4

# Poll until the backend is actually responding
$maxWait = 20
$waited = 0
while ($waited -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000" -TimeoutSec 1 -ErrorAction SilentlyContinue
        break
    } catch {
        Start-Sleep -Seconds 1
        $waited++
    }
}

if ($waited -ge $maxWait) {
    Write-Host "  [WARN] Backend may not be ready yet. Starting Electron anyway..." -ForegroundColor Yellow
} else {
    Write-Host "  [   ] Backend is ready!" -ForegroundColor Green
}

# --- Start Electron ---
Write-Host "  [2/2] Starting Electron App..." -ForegroundColor Green
Write-Host ""
Set-Location $RootDir
npm start

# --- Cleanup ---
Write-Host ""
Write-Host "  Thinker closed. Shutting down backend..." -ForegroundColor Gray
if ($backendProcess -and !$backendProcess.HasExited) {
    Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
}
Write-Host "  Done. Goodbye!" -ForegroundColor Cyan
Start-Sleep -Seconds 2
