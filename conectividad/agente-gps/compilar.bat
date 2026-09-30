@echo off
REM ELETEK - Compilar el agente GPS
REM Usa el compilador que ya viene con Windows: no hay que instalar nada.
setlocal

set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo No se encontro el compilador de .NET Framework 4.0.
  exit /b 1
)

"%CSC%" /nologo /target:winexe /out:EletekGPS.exe /platform:anycpu ^
  /reference:System.dll ^
  /reference:System.Drawing.dll ^
  /reference:System.Windows.Forms.dll ^
  /optimize+ ^
  EletekGPS.cs

if errorlevel 1 (
  echo.
  echo FALLO la compilacion.
  exit /b 1
)

echo.
echo Listo: EletekGPS.exe
endlocal
