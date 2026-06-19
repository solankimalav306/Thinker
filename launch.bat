@echo off
title Thinker - Launcher
color 0A

echo.
echo  ==========================================
echo   Thinker - AI PDF Reader
echo   Starting up...
echo  ==========================================
echo.
echo  The backend is now managed automatically by Electron.
echo  A splash screen will display while the backend initialises.
echo.

cd /d "%~dp0"
npm start

echo.
echo  Thinker closed. Goodbye!
timeout /t 2 /nobreak >nul
