@echo off
chcp 65001 >nul
title 果管扫码桥接服务
echo.
echo   检查Python环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo   [错误] 未找到Python! 请先安装Python 3.8+
    echo   下载地址: https://www.python.org/downloads/
    echo.
    pause
    exit /b
)
echo   安装依赖...
pip install pyserial >nul 2>&1
echo   启动服务...
echo.
python "%~dp0scan_bridge.py"
pause
