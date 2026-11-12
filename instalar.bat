@echo off
cd /d "%~dp0"
echo Instalando Herencia Cuero...
where node >nul 2>nul || (echo Falta instalar Node.js 22 desde https://nodejs.org & pause & exit /b 1)
call npm ci || (echo Error instalando dependencias & pause & exit /b 1)
call npm run build || (echo Error al compilar & pause & exit /b 1)
echo.
echo Listo. Ahora abri "Iniciar Herencia.bat".
pause
