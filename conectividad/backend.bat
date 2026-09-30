@echo off
:: Mantiene el backend de ELETEK siempre levantado.
::
:: Si node se cierra por cualquier motivo (error, falla de la base, o el
:: control de salud de server.js que decide reiniciar), esta ventana lo
:: vuelve a arrancar a los 5 segundos. Para detener el servidor de verdad,
:: cerrar esta ventana.
cd /d "%~dp0"
title ELETEK Backend
:loop
node server.js
echo.
echo [%date% %time%] El servidor se detuvo. Reiniciando en 5 segundos...
echo (Para detenerlo del todo, cerrar esta ventana.)
timeout /t 5 /nobreak >nul
goto loop
