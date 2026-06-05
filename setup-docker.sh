#!/bin/bash

# 自动安装 Docker 和 Docker Compose（适用于 Ubuntu/Debian）
# Usage: bash setup-docker.sh

set -e

echo "========================================="
echo "Docker 安装脚本"
echo "========================================="

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
fi

if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
    echo "检测到系统: $OS"
else
    echo "警告: 此脚本适用于 Ubuntu/Debian 系统"
    echo "当前系统: $OS"
    read -p "是否继续？(y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "[1/4] 更新系统包..."
apt-get update -y

echo ""
echo "[2/4] 安装依赖..."
apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git

echo ""
echo "[3/4] 安装 Docker..."
# Remove old versions
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/$OS/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/$OS \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo ""
echo "[4/4] 验证安装..."
docker --version
docker compose version

# Add current user to docker group
usermod -aG docker $USER 2>/dev/null || true

echo ""
echo "========================================="
echo "Docker 安装完成!"
echo "========================================="
echo ""
echo "版本信息:"
docker --version
docker compose version
echo ""
echo "如需当前用户使用 docker 命令，请重新登录或运行:"
echo "  newgrp docker"
echo ""
echo "现在可以运行部署脚本了:"
echo "  bash deploy.sh"
