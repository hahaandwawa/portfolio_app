@echo off
chcp 65001 >nul
title Portfolio Guard 启动器

REM Portfolio Guard 启动脚本 (Windows)
REM 双击此文件即可启动应用

REM 获取脚本所在目录
cd /d "%~dp0"

echo ==================================
echo   Portfolio Guard 启动器
echo ==================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误：未检测到 Node.js
    echo.
    echo 请先安装 Node.js：
    echo 1. 访问 https://nodejs.org/zh-cn
    echo 2. 下载并安装 LTS 版本
    echo 3. 安装完成后重新运行此脚本
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo ✅ Node.js 已安装: %NODE_VERSION%
echo.

REM 检查依赖是否安装
if not exist "node_modules" (
    echo 📦 首次运行，正在安装依赖...
    echo    这可能需要 1-5 分钟，请耐心等待...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo ❌ 依赖安装失败
        echo.
        echo 可能的解决方法：
        echo 1. 检查网络连接
        echo 2. 使用国内镜像源：
        echo    npm config set registry https://registry.npmmirror.com
        echo    然后重新运行此脚本
        echo.
        pause
        exit /b 1
    )
    
    echo.
    echo ✅ 依赖安装完成
    echo.
    
    REM 初始化数据库
    echo 🗄️  正在初始化数据库...
    call npm run db:init
    if %errorlevel% neq 0 (
        echo.
        echo ❌ 数据库初始化失败
        pause
        exit /b 1
    )
    echo ✅ 数据库初始化完成
    echo.
)

REM 启动应用
echo 🚀 正在启动应用...
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   重要提示：
echo   • 应用启动后，请保持此窗口打开
echo   • 关闭应用时，请在此窗口按 Ctrl+C
echo   • 启动完成后，请在浏览器打开：
echo     http://localhost:3000
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

call npm run dev

pause
