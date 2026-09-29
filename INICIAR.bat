@echo off
chcp 65001 >nul
title QuestVTT - Servidor da Mesa
cd /d "%~dp0"

echo.
echo   ============================================
echo      QuestVTT - iniciando a mesa
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERRO] O Node.js nao esta instalado.
  echo   Baixe a versao LTS em https://nodejs.org e instale.
  echo   Depois feche esta janela e de dois cliques em INICIAR.bat de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   Primeira execucao: instalando dependencias. Isso leva alguns minutos...
  echo.
  call npm install --omit=dev
  if errorlevel 1 (
    echo.
    echo   [ERRO] Falha ao instalar as dependencias. Veja LEIA-ME-REDE.md, secao "Problemas".
    pause
    exit /b 1
  )
)

node server\index.js
echo.
echo   O servidor foi encerrado.
pause
