@echo off
setlocal
cd /d "%~dp0"

:: ── Locate Python ────────────────────────────────────────────────────────────
:: Prefer the bundled portable runtime shipped with ORCHID so the app works
:: on any Windows PC with no installation required.
set "PYTHON_EXE="

if exist "%~dp0python-runtime\python.exe" (
    set "PYTHON_EXE=%~dp0python-runtime\python.exe"
    goto python_found
)

where py >nul 2>nul
if not errorlevel 1 (
    set "PYTHON_EXE=py -3"
    goto python_found
)

where python >nul 2>nul
if not errorlevel 1 (
    set "PYTHON_EXE=python"
    goto python_found
)

powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Python was not found and no bundled runtime is present.' + [Environment]::NewLine + [Environment]::NewLine + 'Copy the python-runtime folder into the ORCHID directory and try again.' + [Environment]::NewLine + [Environment]::NewLine + 'Contact your ORCHID administrator if you need help.', 'ORCHID — Python not found', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)"
exit /b 1

:python_found

:: ── Choose data source ───────────────────────────────────────────────────────
if "%~1"=="--mock-data" goto run_explicit_demo

if not exist "demo\data.json" goto run_real

powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $choice = [System.Windows.Forms.MessageBox]::Show('Choose which data source to open.' + [Environment]::NewLine + [Environment]::NewLine + 'Yes: Real sensor database' + [Environment]::NewLine + 'No: Demo data' + [Environment]::NewLine + 'Cancel: Exit', 'ORCHID', [System.Windows.Forms.MessageBoxButtons]::YesNoCancel, [System.Windows.Forms.MessageBoxIcon]::Question); if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 }; if ($choice -eq [System.Windows.Forms.DialogResult]::No) { exit 1 }; exit 2"
if errorlevel 2 exit /b 0
if errorlevel 1 goto run_demo

:run_real
:: ── Kill any orphaned ORCHID processes from a previous session ────────────────
:: This releases COM port locks left behind when the window was closed abruptly.
echo Stopping any previous ORCHID processes...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*logger.py*' -or $_.CommandLine -like '*serve.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 1 /nobreak >nul

echo Running database backup...
%PYTHON_EXE% scripts\backup_db.py
if errorlevel 1 echo Warning: backup did not complete. Check DB\backups\.
start "ORCHID serial logger" /b cmd /c "cd /d ""%~dp0DB"" && call run.bat"
call :run_server %*
exit /b %errorlevel%

:run_demo
call :run_server --mock-data %*
exit /b %errorlevel%

:run_explicit_demo
call :run_server %*
exit /b %errorlevel%

:run_server
:server_loop
%PYTHON_EXE% scripts\serve.py %*
echo.
echo ============================================================
echo   ORCHID stopped. Restarting in 5 seconds...
echo   Close this window only if you want to stop ORCHID.
echo ============================================================
timeout /t 5 /nobreak
goto server_loop
