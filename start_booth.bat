@echo off
setlocal enabledelayedexpansion
title Photobooth Master Suite (All-in-One)

set "PRINT_DIR=C:\Users\hh\Downloads\Photobooth"
set "FOG_DIR=C:\Users\hh\.gemini\antigravity\scratch\picnic-fog-photobooth"

echo ========================================================
echo          STARTING PICNIC FOG PHOTOBOOTH SUITE
echo ========================================================

:: 1. Start the Fog Photobooth + QR GIF Server (server.ps1) if port 8080 is not listening
netstat -ano | findstr /R /C:":8080 .*LISTENING" >NUL 2>&1
if errorlevel 1 (
    echo [1/3] Starting Fog Photobooth ^& QR Server on http://127.0.0.1:8080 ...
    start "Picnic Fog Server" /min powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%FOG_DIR%'; .\server.ps1"
    timeout /t 2 /nobreak >NUL
) else (
    echo [1/3] Fog Photobooth Server is already running on port 8080.
)

:: 2. Open the Photobooth in the browser
echo [2/3] Opening http://127.0.0.1:8080 in browser...
start "" "http://127.0.0.1:8080"

:: 3. Start the Automated Layout & IrfanView Print Worker
echo [3/3] Starting Automated Layout ^& Print Engine...
echo.
cd /d "%PRINT_DIR%"

:: Verify Python installation
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python 3 was not found in your system PATH.
    echo Please install Python and check "Add Python to PATH".
    pause
    exit /b
)

:: Pass "manual" to use the legacy step-by-step menu
if /i "%~1"=="manual" goto MENU_FORMAT

:AUTO_LOOP
python booth_worker.py --auto
echo.
echo Worker stopped. Restarting in 2 seconds (Press Ctrl+C to quit)...
timeout /t 2 >nul
goto AUTO_LOOP

:MENU_FORMAT
cls
set LAYOUT=
set ORIENTATION=portrait
set TEMPLATE=
set COPIES=1

echo ========================================================
echo               STEP 1: SELECT PRINT FORMAT
echo ========================================================
echo  [1] 2x6 Strip          (1x4 strip - 4 shots)
echo  [2] 2.16x3.4 Photocard (K-pop / ID card - 1 shot)
echo  [3] 24x72mm Mini-Strip (Acrylic toploader - 4 shots)
echo  [4] 4x6 Grid 2x2       (4 shots)
echo  [5] 4x6 Grid 2x3       (6 shots)
echo ========================================================
set /p FMT_CHOICE="Select format (1-5): "

if "%FMT_CHOICE%"=="1" set LAYOUT=2x6_strip4
if "%FMT_CHOICE%"=="2" set LAYOUT=photocard
if "%FMT_CHOICE%"=="3" set LAYOUT=mini_strip24x72
if "%FMT_CHOICE%"=="4" set LAYOUT=4x6_grid2x2
if "%FMT_CHOICE%"=="5" set LAYOUT=4x6_grid2x3

if not defined LAYOUT (
    echo Invalid selection. Please choose between 1 and 5.
    timeout /t 2 >nul
    goto MENU_FORMAT
)

:MENU_ORIENTATION
cls
echo ========================================================
echo               STEP 2: SELECT ORIENTATION
echo ========================================================
echo  [1] Portrait (Vertical)
echo  [2] Landscape (Horizontal)
echo ========================================================
set /p ORI_CHOICE="Select orientation (1-2): "

if "%ORI_CHOICE%"=="2" (
    set ORIENTATION=landscape
) else (
    set ORIENTATION=portrait
)

:MENU_TEMPLATE
cls
echo ========================================================
echo               STEP 3: SELECT FRAME DESIGN
echo ========================================================
echo Available designs in templates\%LAYOUT%:
echo  [0] None / Plain White Canvas

set COUNT=0
set TDIR=templates\%LAYOUT%

if exist "%TDIR%" (
    for %%f in ("%TDIR%\*.png") do (
        set /a COUNT+=1
        set "DESIGN_!COUNT!=%%~nxf"
        echo  [!COUNT!] %%~nxf
    )
)

echo ========================================================
set /p TMPL_CHOICE="Select design number (0-%COUNT%): "

if "%TMPL_CHOICE%"=="0" (
    set TEMPLATE=none
) else (
    set TEMPLATE=!DESIGN_%TMPL_CHOICE%!
)

if not defined TEMPLATE (
    set TEMPLATE=none
)

:MENU_COPIES
cls
echo ========================================================
echo               STEP 4: NUMBER OF PRINTS
echo ========================================================
set /p COPIES="Enter number of copies to spool (default 1): "
if not defined COPIES set COPIES=1

cls
echo ========================================================
echo              PHOTOBOOTH SESSION ACTIVE
echo ========================================================
echo Layout:      %LAYOUT%
echo Orientation: %ORIENTATION%
echo Frame:       %TEMPLATE%
echo Copies:      %COPIES%
echo.
echo Ready for guest captures. Waiting for camera...
echo ========================================================

python booth_worker.py --layout %LAYOUT% --orientation %ORIENTATION% --template "%TEMPLATE%" --copies %COPIES%

echo.
echo Session finished! Resetting menu for the next guest...
timeout /t 2 >nul
goto MENU_FORMAT
