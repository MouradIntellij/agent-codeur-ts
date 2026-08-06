@echo off
chcp 65001 >nul
title Codeur TS - Installation
echo ============================================================
echo   Codeur TS - Installation sur ce poste, a faire UNE SEULE fois
echo ============================================================
echo.
cd /d "%~dp0"

where node >nul 2>&1
if not errorlevel 1 goto node_ok
echo [ERREUR] Node.js introuvable.
echo Installez Node.js depuis nodejs.org, puis relancez ce script.
pause
exit /b 1
:node_ok

where ollama >nul 2>&1
if not errorlevel 1 goto ollama_ok
echo [ERREUR] Ollama introuvable.
echo Installez Ollama depuis ollama.com - gratuit, fonctionne ensuite sans Internet.
pause
exit /b 1
:ollama_ok

echo [1/4] Verification du modele local qwen2.5...
ollama list | findstr /i "qwen2.5" >nul
if not errorlevel 1 goto modele_ok
echo [INFO] Modele absent : telechargement 2 Go, Internet requis une seule fois.
ollama pull qwen2.5:latest
:modele_ok

echo [2/4] Installation des dependances TypeScript...
if exist "node_modules" goto deps_ok
call npm install
:deps_ok

echo [3/4] Verification des types...
call npm run typecheck

echo [4/4] Installation terminee.
echo.
echo Pour lancer l'agent : double-cliquez sur demarrer-agent.bat
echo Aucun Internet necessaire pour l'utilisation.
pause
