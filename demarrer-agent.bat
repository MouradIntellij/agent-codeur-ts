@echo off
chcp 65001 >nul
title Codeur — Agent IA local (sans éditeur)
echo ============================================================
echo   Codeur - Agent IA de codage (100%% hors ligne)
echo   Demarrage en cours, patientez quelques secondes...
echo ============================================================
echo.

REM 1) On se place dans le dossier de l'agent
cd /d "%~dp0"

REM 2) Node.js present ?
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Node.js introuvable. Installez Node.js puis reessayez.
    pause
    exit /b 1
)

REM 3) Dependances installees ? (une seule fois, avec Internet)
if not exist "node_modules" (
    echo [INFO] Installation des dependances via npm install, une seule fois.
    echo        Cette etape necessite Internet. Patientez...
    call npm install
    if errorlevel 1 (
        echo [ERREUR] npm install a echoue. Verifiez la connexion Internet.
        pause
        exit /b 1
    )
)

REM 4) Ollama demarre ? Sinon on le lance
where ollama >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Ollama introuvable. Installez Ollama depuis ollama.com.
    pause
    exit /b 1
)
curl -s -m 2 http://127.0.0.1:11434 >nul
if errorlevel 1 (
    echo [INFO] Ollama ne repond pas : demarrage en arriere-plan...
    start "" /b ollama serve
    timeout /t 5 /nobreak >nul
)

REM 5) On ouvre le navigateur apres 4 s, pendant que le serveur monte
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:3000"

REM 6) Lancement du serveur web (reste ouvert jusqu'a Ctrl+C)
echo.
echo   La page web va s'ouvrir dans votre navigateur : http://127.0.0.1:3000
echo   Pour arreter : fermez cette fenetre ou faites Ctrl+C.
echo.
npm run web

pause
