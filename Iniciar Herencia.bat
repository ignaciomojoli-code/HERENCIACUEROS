@echo off
cd /d "%~dp0"
title Herencia Cuero - Sistema de gestion (no cerrar esta ventana)
if not exist dist-server\server\index.js (echo Primero ejecuta instalar.bat & pause & exit /b 1)
set NODE_ENV=production
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3800"
node dist-server\server\index.js
pause
