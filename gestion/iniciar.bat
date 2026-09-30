@echo off
:: ELETEK Gestion: arranca el servidor y lo mantiene levantado.
::
:: Corre al lado del panel de conectividad (API MIKRO), en el puerto 3100.
:: No toca ese sistema: a proposito NO hace "taskkill node.exe", que
:: cerraria tambien el panel de los barcos.
::
:: Si node se cierra por cualquier motivo, lo vuelve a arrancar a los 5
:: segundos. Para detenerlo, cerrar esta ventana.
cd /d "%~dp0"
title ELETEK Gestion
if not exist .env (
  echo [ERROR] Falta el archivo .env. Copia .env.example como .env y completalo.
  pause
  exit /b 1
)
:loop
node server.js
echo.
echo [%date% %time%] El servidor se detuvo. Reiniciando en 5 segundos...
echo (Para detenerlo del todo, cerrar esta ventana.)
timeout /t 5 /nobreak >nul
goto loop
