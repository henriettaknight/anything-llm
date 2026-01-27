#!/bin/bash

# Keycloak Docker 快速启动脚本
# 
# 此脚本将启动一个 Keycloak 开发服务器用于测试
# 
# 使用方法：
#   bash start-keycloak-docker.sh
#
# 或者在 Windows PowerShell 中：
#   docker run -d --name keycloak -p 8180:8080 -e KEYCLOAK_ADMIN=admin -e KEYCLOAK_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak:26.1.1 start-dev

echo "========================================="
echo "  Keycloak Docker 快速启动"
echo "========================================="
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误：Docker 未安装"
    echo "请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

echo "✓ Docker 已安装"

# 检查是否已有 keycloak 容器
if docker ps -a | grep -q keycloak; then
    echo ""
    echo "⚠️  检测到已存在的 Keycloak 容器"
    echo ""
    echo "选择操作："
    echo "  1) 启动现有容器"
    echo "  2) 删除并重新创建"
    echo "  3) 取消"
    echo ""
    read -p "请选择 (1-3): " choice
    
    case $choice in
        1)
            echo ""
            echo "启动现有 Keycloak 容器..."
            docker start keycloak
            ;;
        2)
            echo ""
            echo "删除现有容器..."
            docker rm -f keycloak
            echo "创建新的 Keycloak 容器..."
            docker run -d \
              --name keycloak \
              -p 8180:8080 \
              -e KEYCLOAK_ADMIN=admin \
              -e KEYCLOAK_ADMIN_PASSWORD=admin \
              quay.io/keycloak/keycloak:26.1.1 \
              start-dev
            ;;
        3)
            echo "取消操作"
            exit 0
            ;;
        *)
            echo "无效选择"
            exit 1
            ;;
    esac
else
    echo ""
    echo "创建新的 Keycloak 容器..."
    docker run -d \
      --name keycloak \
      -p 8180:8080 \
      -e KEYCLOAK_ADMIN=admin \
      -e KEYCLOAK_ADMIN_PASSWORD=admin \
      quay.io/keycloak/keycloak:26.1.1 \
      start-dev
fi

echo ""
echo "========================================="
echo "  Keycloak 启动成功！"
echo "========================================="
echo ""
echo "访问信息："
echo "  URL: http://localhost:8180"
echo "  管理员用户名: admin"
echo "  管理员密码: admin"
echo ""
echo "等待 Keycloak 完全启动（约 30-60 秒）..."
echo "你可以运行以下命令查看日志："
echo "  docker logs -f keycloak"
echo ""
echo "启动完成后，请访问管理控制台配置 realm 和 client"
echo "或参考 KEYCLOAK_TESTING_GUIDE.md 进行配置"
echo ""
