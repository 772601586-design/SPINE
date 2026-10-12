@echo off
chcp 65001 >nul
setlocal

rem Silent install of WeChat DevTools to D: drive.
rem Requires administrator: right-click this file -> Run as administrator.

set INSTALLER=D:\SPINE\.tools\downloads\wechat_devtools_2.02.2609231_win32_x64.exe
set TARGET=D:\app\wechat_devtools

if not exist "%INSTALLER%" (
  echo [ERROR] Installer not found:
  echo   %INSTALLER%
  echo Download it first from https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
  pause
  exit /b 1
)

echo Installing WeChat DevTools to %TARGET% ...
"%INSTALLER%" /S /D=%TARGET%

echo.
if exist "%TARGET%\cli.bat" (
  echo [OK] Installed. CLI entry: %TARGET%\cli.bat
) else (
  echo [WARN] Installer finished but %TARGET%\cli.bat was not found.
  echo Check %TARGET% manually.
)
pause
