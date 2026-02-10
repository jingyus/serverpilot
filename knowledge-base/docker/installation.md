# Docker 安装指南

## 概述

Docker 是容器化平台，用于构建、分发和运行容器化应用程序。包含 Docker Engine（守护进程）和 Docker CLI（命令行工具）。

## Ubuntu 安装

### 使用官方仓库安装

```bash
# 卸载旧版本
sudo apt remove -y docker docker-engine docker.io containerd runc

# 安装依赖
sudo apt update
sudo apt install -y ca-certificates curl gnupg

# 添加 Docker GPG 密钥
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 添加仓库
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker Engine
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动并设置开机自启
sudo systemctl start docker
sudo systemctl enable docker
```

### 一键安装脚本

```bash
# 使用官方安装脚本（适用于测试环境）
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

## CentOS/RHEL 安装

```bash
# 卸载旧版本
sudo yum remove -y docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine

# 安装依赖
sudo yum install -y yum-utils

# 添加仓库
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 安装 Docker Engine
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动服务
sudo systemctl start docker
sudo systemctl enable docker
```

## Debian 安装

```bash
# 安装依赖
sudo apt update
sudo apt install -y ca-certificates curl gnupg

# 添加 Docker GPG 密钥
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 添加仓库
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 安装后配置

### 非 root 用户运行 Docker

```bash
# 将当前用户添加到 docker 组
sudo usermod -aG docker $USER

# 重新登录使生效
newgrp docker

# 验证
docker run hello-world
```

### 配置 Docker Daemon

```json
// /etc/docker/daemon.json
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "default-address-pools": [
    {"base": "172.17.0.0/16", "size": 24}
  ],
  "dns": ["8.8.8.8", "8.8.4.4"]
}
```

```bash
# 应用配置
sudo systemctl daemon-reload
sudo systemctl restart docker
```

### 配置镜像加速（中国用户）

```json
// /etc/docker/daemon.json
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
```

## 安装 Docker Compose V2

```bash
# Docker Compose 已作为 Docker 插件安装
# 验证
docker compose version

# 如果需要独立安装
sudo apt install -y docker-compose-plugin
```

## 安装后验证

```bash
# 查看版本
docker --version
docker compose version

# 运行测试容器
docker run hello-world

# 查看系统信息
docker info

# 查看 Docker 服务状态
sudo systemctl status docker
```

## 关键文件路径

| 文件/目录 | 路径 |
|-----------|------|
| 守护进程配置 | `/etc/docker/daemon.json` |
| 数据目录 | `/var/lib/docker/` |
| 镜像存储 | `/var/lib/docker/image/` |
| 容器存储 | `/var/lib/docker/containers/` |
| 卷存储 | `/var/lib/docker/volumes/` |
| 日志 | `/var/log/docker.log` 或 `journalctl -u docker` |
| Socket | `/var/run/docker.sock` |
