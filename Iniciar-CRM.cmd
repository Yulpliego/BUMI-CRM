@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Iniciar-CRM.ps1" %*
if errorlevel 1 pause
