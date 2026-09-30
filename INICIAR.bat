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

node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo   [ERRO] Seu Node.js e antigo demais. Instale o Node.js 22 LTS ou mais novo
  echo   em https://nodejs.org e rode INICIAR.bat de novo.
  echo.
  pause
  exit /b 1
)

:: Instalacao completa deixa o arquivo node_modules\.package-lock.json.
:: Se ele nao existir, apaga restos de uma tentativa anterior e instala de novo.
if not exist "node_modules\.package-lock.json" (
  if exist "node_modules\" (
    echo   Limpando uma instalacao anterior incompleta...
    rmdir /s /q "node_modules" 2>nul
  )
  echo   Primeira execucao: instalando dependencias. Isso leva alguns minutos...
  echo.
  call npm install --omit=dev --no-audit --no-fund
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
