@echo off
cd /d "%~dp0"
echo Instalando Herencia Cuero...
where node >nul 2>nul || (echo Falta instalar Node.js 22 desde https://nodejs.org & pause & exit /b 1)
rem better-sqlite3 ya trae el binario de Windows: sin scripts no hace falta Python ni compilador.
call npm ci --ignore-scripts || (echo Error instalando dependencias & pause & exit /b 1)
call npm rebuild esbuild || (echo Error preparando esbuild & pause & exit /b 1)
call npm run build || (echo Error al compilar & pause & exit /b 1)
echo.
echo Listo. Ahora abri "Iniciar Herencia.bat".
pause
