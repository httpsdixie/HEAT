@echo off
setlocal

set "TASK_NAME=ORCHID Dashboard"

echo.
echo   ORCHID - Remove Auto-Start
echo   ===========================
echo.

schtasks /delete /tn "%TASK_NAME%" /f >nul 2>nul

if errorlevel 1 (
    echo   The "%TASK_NAME%" task was not found or could not be removed.
) else (
    echo   Done.  ORCHID will no longer start automatically at login.
)

echo.
pause
