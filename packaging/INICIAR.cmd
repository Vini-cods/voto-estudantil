@echo off
title Urna Estudantil - Araci Zebral Teixeira
cd /d "%~dp0"
"%~dp0UrnaEstudantil.exe"
if errorlevel 1 (
  echo.
  echo A urna nao foi iniciada. Leia a mensagem acima.
  echo Preserve a pasta Dados e consulte o manual.
  pause
)
