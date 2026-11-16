@echo off
rem Actualiza el sistema a la ultima version publicada. NO toca la carpeta "datos" (base y backups).
rem Uso: doble clic (rama main) o "actualizar.bat nombre-de-rama".
cd /d "%~dp0"
set RAMA=%1
if "%RAMA%"=="" set RAMA=main
echo Antes de seguir, cerra la ventana "Herencia Cuero - Sistema de gestion" si esta abierta.
pause
rem Copia de seguridad de la base antes de actualizar (por si la version nueva cambia su estructura).
if exist datos\herencia.db (
  if not exist datos\backups mkdir datos\backups
  powershell -NoProfile -Command "Copy-Item 'datos\herencia.db' ('datos\backups\antes-de-actualizar-' + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.db')" || (echo No se pudo copiar la base: no se actualiza & pause & exit /b 1)
  echo Copia de la base guardada en datos\backups.
)
set TMPZIP=%TEMP%\herencia-actualizacion.zip
set TMPDIR=%TEMP%\herencia-actualizacion
if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"
echo Bajando la version "%RAMA%"...
powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/ignaciomojoli-code/HERENCIACUEROS/archive/refs/heads/%RAMA%.zip' -OutFile '%TMPZIP%'; Expand-Archive -Force '%TMPZIP%' '%TMPDIR%'" || (echo No se pudo bajar la actualizacion & pause & exit /b 1)
for /d %%D in ("%TMPDIR%\*") do set ORIGEN=%%D
rem Copia el codigo nuevo sin tocar datos, dependencias ni compilados viejos.
robocopy "%ORIGEN%" "%~dp0." /E /XD datos node_modules .git /NFL /NDL /NJH /NJS >nul
if errorlevel 8 (echo Error copiando archivos & pause & exit /b 1)
call npm ci || (echo Error instalando dependencias & pause & exit /b 1)
call npm run build || (echo Error al compilar & pause & exit /b 1)
rmdir /s /q "%TMPDIR%" & del "%TMPZIP%"
echo.
echo Listo. Abri "Iniciar Herencia.bat": si la base necesita cambios, se adapta sola al arrancar.
pause
