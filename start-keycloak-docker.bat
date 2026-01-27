@echo off
REM Keycloak Docker 快速启动脚本 (Windows)
REM 
REM 此脚本将启动一个 Keycloak 开发服务器用于测试
REM 
REM 使用方法：
REM   start-keycloak-docker.bat

echo =========================================
echo   Keycloak Docker 快速启动
echo =========================================
echo.

REM 检查 Docker 是否安装
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误：Docker 未安装
    echo 请先安装 Docker: https://docs.docker.com/get-docker/
    pause
    exit /b 1
)

echo ✓ Docker 已安装
echo.

REM 检查是否已有 keycloak 容器
docker ps -a | findstr keycloak >nul 2>&1
if not errorlevel 1 (
    echo ⚠️  检测到已存在的 Keycloak 容器
    echo.
    echo 选择操作：
    echo   1^) 启动现有容器
    echo   2^) 删除并重新创建
    echo   3^) 取消
    echo.
    set /p choice="请选择 (1-3): "
    
    if "!choice!"=="1" (
        echo.
        echo 启动现有 Keycloak 容器...
        docker start keycloak
    ) else if "!choice!"=="2" (
        echo.
        echo 删除现有容器...
        docker rm -f keycloak
        echo 创建新的 Keycloak 容器...
        docker run -d --name keycloak -p 8180:8080 -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak:26.1.1 start-dev
    ) else if "!choice!"=="3" (
        echo 取消操作
        exit /b 0
    ) else (
        echo 无效选择
        pause
        exit /b 1
    )
) else (
    echo 创建新的 Keycloak 容器...
    docker run -d --name keycloak -p 8180:8080 -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak:26.1.1 start-dev
)

echo.
echo =========================================
echo   Keycloak 启动成功！
echo =========================================
echo.
echo 访问信息：
echo   URL: http://localhost:8180
echo   管理员用户名: admin
echo   管理员密码: admin
echo.
echo 等待 Keycloak 完全启动（约 30-60 秒）...
echo 你可以运行以下命令查看日志：
echo   docker logs -f keycloak
echo.
echo 启动完成后，请访问管理控制台配置 realm 和 client
echo 或参考 KEYCLOAK_TESTING_GUIDE.md 进行配置
echo.
pause
