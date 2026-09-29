@echo off
chcp 65001 >nul
title QuestVTT - Liberar Firewall
cd /d "%~dp0"

:: Precisa ser executado como administrador
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Este script precisa de permissao de administrador.
  echo   Clique com o botao direito em LIBERAR-FIREWALL.bat e escolha
  echo   "Executar como administrador".
  echo.
  pause
  exit /b 1
)

:: Le a porta do config.json (padrao 3000)
set PORTA=3000
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { (Get-Content -Raw 'config.json' | ConvertFrom-Json).port } catch { 3000 }"`) do set PORTA=%%P

echo.
echo   Liberando a porta TCP %PORTA% no Firewall do Windows...
netsh advfirewall firewall delete rule name="QuestVTT" >nul 2>&1
netsh advfirewall firewall add rule name="QuestVTT" dir=in action=allow protocol=TCP localport=%PORTA%
if errorlevel 1 (
  echo   [ERRO] Nao foi possivel criar a regra.
) else (
  echo   Pronto! Os jogadores ja podem acessar a porta %PORTA%.
)
echo.
pause
