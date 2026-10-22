@echo off
REM ============================================================
REM  微信小程序自动预览推送脚本
REM  用法:
REM    push-preview.bat          - 单次预览推送
REM    push-preview.bat --auto   - 开启自动预览（每次保存自动推送）
REM    push-preview.bat --off    - 关闭自动预览
REM ============================================================

set CLI="D:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
set PROJECT="D:\Other\P-Program\dsh-weapp\miniprogram"

if "%~1"=="--auto" (
    echo Enabling auto-preview...
    %CLI% auto-preview --enable --project "%PROJECT%"
    if %errorlevel% equ 0 echo ✓ Auto-preview enabled. Changes will be pushed automatically on save.
    pause
    exit /b 0
)

if "%~1"=="--off" (
    echo Disabling auto-preview...
    %CLI% auto-preview --disable --project "%PROJECT%"
    if %errorlevel% equ 0 echo ✓ Auto-preview disabled.
    pause
    exit /b 0
)

echo Pushing preview to connected device...
%CLI% preview --project "%PROJECT%"
pause
