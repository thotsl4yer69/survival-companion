@echo off
rem BLACKBOX Forge launcher for Windows. Usage: forge.cmd init E:\BLACKBOX   (see forge\README.md)
setlocal
set "FORGE=%~dp0forge.py"
where py >nul 2>nul && goto :use_py
where python >nul 2>nul && goto :use_python
echo [forge] Python 3.9 or newer is required.
echo [forge] Install it, then open a new terminal:  winget install -e --id Python.Python.3.12
exit /b 9009

:use_py
py -3 "%FORGE%" %*
exit /b %ERRORLEVEL%

:use_python
python "%FORGE%" %*
exit /b %ERRORLEVEL%
