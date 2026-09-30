@echo off
cd /d "%~dp0"
title ELETEK - Sistema de Administracion Remota

echo ===================================================
echo   ELETEK - Limpiando procesos anteriores...
echo ===================================================
:: Primero la ventana que reinicia el backend: si se matara solo node, esa
:: ventana lo volveria a levantar y quedarian dos servidores peleando.
taskkill /F /T /FI "WINDOWTITLE eq ELETEK Backend*" >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM caddy.exe >nul 2>&1
echo.
echo ===================================================
echo   ELETEK - Iniciando servicios...
echo ===================================================
echo.

echo Iniciando backend Node.js en puerto 3000...
start "ELETEK Backend" cmd /k backend.bat

:: Verificar si Caddy esta configurado
if not exist Caddyfile (
    echo [INFO] Creando Caddyfile por defecto desde Caddyfile.example...
    copy Caddyfile.example Caddyfile >nul
    echo.
    echo [ATENCION] Caddyfile creado. DEBES editarlo y poner tu dominio DDNS real antes de usarlo en produccion.
    echo.
)

:: Verificar si Caddy existe y esta en el mismo directorio
if exist caddy.exe (
    echo Iniciando reverse proxy HTTPS Caddy...
    start "ELETEK HTTPS Caddy" cmd /k "caddy run"
) else (
    echo [ADVERTENCIA] No se encontro caddy.exe. El sistema correra en HTTP local.
    echo Si queres acceso HTTPS automatico, asegurate de que caddy.exe este en esta carpeta.
)

echo.
echo ===================================================
echo   SERVICIOS INICIADOS
echo ===================================================
echo   - Backend (Local): http://localhost:3000
echo   - Cierra las ventanas que se abrieron para detener el sistema.
echo ===================================================
echo.
pause
