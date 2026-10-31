@echo off
:loop
python logger.py
echo Restarting in 5 seconds...
timeout /t 5
goto loop