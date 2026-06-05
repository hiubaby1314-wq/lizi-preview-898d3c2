#!/bin/bash

# 栗子素材网 - Hong Kong VPS Deployment Script
# Usage: bash deploy.sh

set -e

DOMAIN="lizisucaiwang.online"
EMAIL="hiubaby1314@gmail.com"

echo "========================================="
echo "栗子素材网 - VPS 部署脚本"
echo "========================================="

# Step 1: Check prerequisites
echo ""
echo "[1/7] 检查依赖..."
command -v docker >/dev/null 2>&1 || { echo "错误: 请先安装 Docker"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || COMPOSE_CMD="docker compose" || { echo "错误: 请先安装 Docker Compose"; exit 1; }
COMPOSE_CMD=${COMPOSE_CMD:-"docker-compose"}
echo "  ✓ Docker 已安装"

# Step 2: Create directory structure
echo ""
echo "[2/7] 创建目录结构..."
mkdir -p certbot/conf certbot/www data
echo "  ✓ 目录创建完成"

# Step 3: Setup environment
echo ""
echo "[3/7] 配置环境变量..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  ✓ 已创建 .env 文件"
    echo "  请根据需要编辑 .env 文件"
else
    echo "  ✓ .env 文件已存在"
fi

# Step 4: Get SSL certificate (first time only)
echo ""
echo "[4/7] 配置 SSL 证书..."
if [ ! -f "certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
    echo "  首次部署，需要申请 SSL 证书..."
    echo ""
    echo "  请确保:"
    echo "  1. 域名 $DOMAIN 已解析到此服务器 IP"
    echo "  2. 服务器 80 端口已开放"
    echo ""
    read -p "  确认已准备好？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Start nginx temporarily on port 80 only
        $COMPOSE_CMD run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot --email $EMAIL -d $DOMAIN -d www.$DOMAIN --agree-tos --no-eff-email" certbot
        echo "  ✓ SSL 证书申请成功"
    else
        echo "  跳过 SSL 证书申请"
    fi
else
    echo "  ✓ SSL 证书已存在"
fi

# Step 5: Build and start containers
echo ""
echo "[5/7] 构建并启动容器..."
$COMPOSE_CMD build
$COMPOSE_CMD up -d
echo "  ✓ 容器启动完成"

# Step 6: Verify deployment
echo ""
echo "[6/7] 验证部署..."
sleep 5
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ | grep -q "200"; then
    echo "  ✓ 应用运行正常"
else
    echo "  ⚠ 应用可能未正常启动，请检查日志: docker-compose logs app"
fi

# Step 7: Summary
echo ""
echo "[7/7] 部署完成!"
echo ""
echo "========================================="
echo "部署信息:"
echo "========================================="
echo "网站地址: https://$DOMAIN"
echo "应用日志: $COMPOSE_CMD logs -f app"
echo "Nginx日志: $COMPOSE_CMD logs -f nginx"
echo ""
echo "常用命令:"
echo "  重启应用: $COMPOSE_CMD restart app"
echo "  更新代码: git pull && $COMPOSE_CMD build && $COMPOSE_CMD up -d"
echo "  查看状态: $COMPOSE_CMD ps"
echo "========================================="
