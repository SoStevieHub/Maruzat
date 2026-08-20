@echo off
chcp 65001 >nul
title Mental0
cd /d "%~dp0"

echo.
echo   Mental0 baslatiliyor...
echo.

if not exist "node_modules\" (
  echo   Ilk acilis: bagimliliklar kuruluyor, biraz surebilir...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Kurulum basarisiz. Node.js yuklu mu?
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo   .env bulunamadi. .env.example dosyasini .env olarak kopyalayip
  echo   API anahtarlarini doldurman gerekiyor.
  echo.
  pause
  exit /b 1
)

rem Sunucu dinlemeye baslayinca paneli tarayicida acsin
set OPEN_BROWSER=1

node server.js

rem Buraya sadece sunucu durdugunda ya da hata verdiginde dusulur
echo.
echo   Mental0 kapandi.
pause
