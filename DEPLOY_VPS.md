# 栗子素材网 - 香港 VPS 部署指南

## 前提条件

- 香港 VPS（推荐配置：1核 1GB RAM 以上）
- 已安装 Docker 和 Docker Compose
- 域名 `lizisucaiwang.online` 已解析到服务器 IP

## 快速部署

### 1. 克隆代码到服务器

```bash
# SSH 登录你的 VPS
ssh root@你的服务器IP

# 安装 Git（如果没有）
apt update && apt install -y git

# 克隆代码
cd /opt
git clone https://github.com/hiubaby1314-wq/hiubaby.git
cd hiubaby/lizi-materials
```

### 2. 配置域名解析

在你的域名 DNS 管理中添加：

```
A    @           你的服务器IP
A    www         你的服务器IP
```

等待 DNS 生效（通常几分钟到几小时）。

### 3. 运行部署脚本

```bash
bash deploy.sh
```

脚本会自动：
- 检查 Docker 环境
- 申请 Let's Encrypt SSL 证书
- 构建 Docker 镜像
- 启动应用和 Nginx

### 4. 验证

浏览器访问 `https://lizisucaiwang.online`

## 常用命令

```bash
# 查看状态
docker-compose ps

# 查看应用日志
docker-compose logs -f app

# 重启应用
docker-compose restart app

# 更新代码后重新部署
git pull
docker-compose build
docker-compose up -d

# 停止所有服务
docker-compose down
```

## 手动部署（如果脚本失败）

```bash
# 1. 复制环境配置
cp .env.example .env

# 2. 编辑 .env（如需修改）
nano .env

# 3. 申请 SSL 证书（首次）
mkdir -p certbot/conf certbot/www
docker-compose run --rm --entrypoint "certbot certonly --webroot -w /var/www/certbot --email hiubaby1314@gmail.com -d lizisucaiwang.online -d www.lizisucaiwang.online --agree-tos --no-eff-email" certbot

# 4. 启动服务
docker-compose build
docker-compose up -d
```

## 故障排除

### 端口被占用
```bash
# 查看占用端口的进程
netstat -tulpn | grep :80
netstat -tulpn | grep :443

# 停止占用进程
kill -9 <PID>
```

### SSL 证书问题
```bash
# 重新申请证书
docker-compose run --rm --entrypoint "certbot delete --cert-name lizisucaiwang.online" certbot
# 然后重新运行部署脚本
```

### 应用无法启动
```bash
# 查看详细日志
docker-compose logs app

# 检查环境变量
docker-compose exec app env
```

## 性能优化建议

1. **开启 Swap**（如果内存不足）
```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

2. **配置防火墙**
```bash
# Ubuntu/Debian
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable

# CentOS
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

3. **定期备份数据库**
```bash
# 添加定时任务
crontab -e

# 每天凌晨 3 点备份
0 3 * * * cd /opt/hiubaby/lizi-materials && docker-compose exec -T app cp /app/data/lizi.db /app/data/lizi_backup_$(date +\%Y\%m\%d).db
```

## 监控

```bash
# 查看资源使用
docker stats

# 查看访问日志
docker-compose logs nginx | tail -100
```
