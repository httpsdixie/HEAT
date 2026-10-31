@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="--mock-data" goto run_explicit_demo
if not exist "demo\data.json" goto run_real
echo Choose ORCHID data source:
echo   Yes = Real sensor database
echo   No  = Demo data
echo   Cancel = Exit
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $choice = [System.Windows.Forms.MessageBox]::Show('Choose which data source to open.' + [Environment]::NewLine + [Environment]::NewLine + 'Yes: Real sensor database' + [Environment]::NewLine + 'No: Demo data' + [Environment]::NewLine + 'Cancel: Exit', 'ORCHID', [System.Windows.Forms.MessageBoxButtons]::YesNoCancel, [System.Windows.Forms.MessageBoxIcon]::Question); if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 }; if ($choice -eq [System.Windows.Forms.DialogResult]::No) { exit 1 }; exit 2"
if errorlevel 2 exit /b 0
if errorlevel 1 goto run_demo

:run_real
start "ORCHID serial logger" /min cmd /c "cd /d ""%~dp0DB"" && call run.bat"
call :run_server %*
exit /b %errorlevel%

:run_demo
call :run_server --mock-data %*
exit /b %errorlevel%

:run_explicit_demo
call :run_server %*
exit /b %errorlevel%

:run_server
where py >nul 2>nul
if not errorlevel 1 (
    py -3 scripts\serve.py %*
) else (
    where python >nul 2>nul
    if errorlevel 1 (
        echo Python 3 was not found. Install Python and try again.
        exit /b 1
    )
    python scripts\serve.py %*
)

exit /b %errorlevel%
