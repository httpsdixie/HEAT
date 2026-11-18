@echo off
setlocal
cd /d "%~dp0.."

:: ============================================================
:: ORCHID — Windows Auto-Start Installer
:: Registers a Task Scheduler task that starts ORCHID
:: automatically every time this user logs in.
::
:: Run this file ONCE as a normal user (no administrator rights
:: needed for a user-level task).
::
:: To remove auto-start:  run uninstall-autostart-windows.bat
:: Or open Task Scheduler and delete the "ORCHID Dashboard" task.
:: ============================================================

set "TASK_NAME=ORCHID Dashboard"
set "ORCHID_DIR=%cd%"
set "BAT_FILE=%ORCHID_DIR%\start-dashboard.bat"

echo.
echo   ORCHID - Windows Auto-Start Installer
echo   =======================================
echo.

:: Check the start script exists
if not exist "%BAT_FILE%" (
    echo   ERROR: start-dashboard.bat not found at:
    echo          %BAT_FILE%
    echo.
    echo   Run this installer from inside the ORCHID folder.
    pause
    exit /b 1
)

:: Delete any existing task with this name before re-registering
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>nul

:: Register the task:
::   - Trigger: at logon of the current user
::   - Action:  run start-dashboard.bat with a minimised window
::   - Run whether or not the user is logged on is NOT set
::     (user-level task only — no elevation, no stored password)
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "cmd /c start \"ORCHID\" /min \"%BAT_FILE%\"" ^
  /sc onlogon ^
  /ru "%USERDOMAIN%\%USERNAME%" ^
  /rl limited ^
  /delay 0000:30 ^
  /f >nul

if errorlevel 1 (
    echo   ERROR: Could not register the scheduled task.
    echo   Try running this script from a Command Prompt.
    pause
    exit /b 1
)

echo   Done.  ORCHID will start automatically when you log in.
echo.
echo   The task is named "%TASK_NAME%" in Task Scheduler.
echo   To remove it, run setup\uninstall-autostart-windows.bat
echo   or open Task Scheduler and delete the task manually.
echo.
pause
