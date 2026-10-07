@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Taijutsu Shuren - Training Log

where node >nul 2>nul
if errorlevel 1 goto nonode

node server.mjs --open
echo.
echo   Server stopped.
pause
exit /b 0

:nonode
echo.
echo   [i] Node.js was not found.
echo       Opening index.html instead - records will be saved inside this browser.
echo       Install Node.js for file storage: https://nodejs.org/
echo.
start "" "index.html"
pause
exit /b 0