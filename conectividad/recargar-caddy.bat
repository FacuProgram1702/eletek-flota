@echo off
:: Aplica cambios del Caddyfile SIN cortar el servicio (los barcos siguen
:: reportando). Primero valida: si el archivo tiene un error, no toca nada.
cd /d "%~dp0"
caddy.exe validate --config Caddyfile || (echo. & echo [ERROR] El Caddyfile tiene un error. No se aplico nada. & pause & exit /b 1)
caddy.exe reload --config Caddyfile && echo. && echo Caddy recargado.
pause
