@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Taijutsu Shuren - Training Log (LAN)

where node >nul 2>nul
if errorlevel 1 goto nonode

set "LANIP="
set "IPTMP=%TEMP%\shuren-lan-ip.txt"
powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | Select-Object -First 1).IPv4Address.IPAddress" > "%IPTMP%" 2>nul
if exist "%IPTMP%" for /f "usebackq delims=" %%i in ("%IPTMP%") do if not defined LANIP set "LANIP=%%i"
if exist "%IPTMP%" del "%IPTMP%" >nul 2>nul

echo.
echo   LAN mode: listening on every network interface.
echo   This machine:  http://127.0.0.1:4173/
if defined LANIP if not "%LANIP%"=="" echo   Other devices: http://%LANIP%:4173/
if not defined LANIP echo   Other devices: check this PC address with ipconfig.
echo.
echo   NOTE: plain HTTP - passwords can be sniffed on the same network.
echo         Use this on a trusted network only.
echo   Stop: close this window.
echo.

node server.mjs --open --host 0.0.0.0
echo.
echo   Server stopped.
pause
exit /b 0

:nonode
echo.
echo   [i] Node.js was not found.
echo       Install Node.js for file storage: https://nodejs.org/
echo.
pause
exit /b 0
