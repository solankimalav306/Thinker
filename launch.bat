@echo off
title Thinker - Launcher
color 0A

echo.
echo  ==========================================
echo   Thinker - AI PDF Reader
echo   Starting up all services...
echo  ==========================================
echo.

:: Check if venv exists
if not exist "%~dp0venv\Scripts\activate.bat" (
    echo  [ERROR] Virtual environment not found at .\venv\
    echo  Please run: python -m venv venv ^&^& pip install -r agent-handler\requirements.txt
    pause
    exit /b 1
)

:: Activate venv and start FastAPI backend in a new window
echo  [1/2] Starting RAG Backend (FastAPI)...
start "Thinker - RAG Backend" /min cmd /k "cd /d %~dp0 && call venv\Scripts\activate.bat && cd agent-handler && fastapi dev --port 8000"

:: Give FastAPI a couple of seconds to boot
echo  [   ] Waiting for backend to initialise...
timeout /t 4 /nobreak >nul

echo  [2/2] Starting Electron App...
echo.
cd /d "%~dp0"
npm start

:: When Electron exits, kill the backend window
echo.
echo  Thinker closed. Shutting down backend...
taskkill /fi "WindowTitle eq Thinker - RAG Backend*" /t /f >nul 2>&1
echo  Done. Goodbye!
timeout /t 2 /nobreak >nul
