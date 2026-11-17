@echo off
cd /d "%~dp0"

:: Prefer the bundled portable runtime one level up
set "PYTHON_EXE="
if exist "%~dp0..\python-runtime\python.exe" (
    set "PYTHON_EXE=%~dp0..\python-runtime\python.exe"
    goto run
)
where py >nul 2>nul
if not errorlevel 1 ( set "PYTHON_EXE=py -3" & goto run )
where python >nul 2>nul
if not errorlevel 1 ( set "PYTHON_EXE=python" & goto run )
echo Python not found. Copy python-runtime into the ORCHID folder.
pause
exit /b 1

:run
:loop
%PYTHON_EXE% logger.py
echo Logger stopped. Restarting in 5 seconds...
timeout /t 5
goto loop
