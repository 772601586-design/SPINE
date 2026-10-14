@echo off
setlocal
REM WeChat login end-to-end check. Run this in YOUR OWN desktop terminal
REM (the agent side cannot start Electron windows).
REM Prereq: devtools has D:\SPINE open, you are signed in, and
REM         Settings -> Security Settings -> Service Port is ON.

set DEVTOOLS=D:\app\wechat_devtools
set NODE_BIN=C:\Users\58724\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
set NODE_PATH=C:\Users\58724\.workbuddy\binaries\node\workspace\node_modules
set SCRIPT=D:\SPINE\scripts\verify-wechat-login.js

echo [1/3] starting automation port 9420 ...
start "devtools-auto" /min cmd /c "cd /d %DEVTOOLS% && cli.bat auto --project D:\SPINE --auto-port 9420"

echo [2/3] waiting for port 9420 (up to 60s) ...
set READY=0
for /l %%i in (1,1,12) do (
  if "%READY%"=="0" (
    timeout /t 5 /nobreak >nul
    netstat -ano | findstr ":9420" | findstr "LISTENING" >nul && set READY=1
  )
)

if "%READY%"=="0" (
  echo [FAIL] port 9420 not ready. Check that the project is open in devtools
  echo        and that the Service Port switch is ON.
  pause
  exit /b 2
)

echo [3/3] running verification ...
"%NODE_BIN%" "%SCRIPT%"
set CODE=%ERRORLEVEL%

echo.
if "%CODE%"=="0" (echo RESULT: PASS) else (echo RESULT: FAIL exitcode=%CODE%)
pause
endlocal
