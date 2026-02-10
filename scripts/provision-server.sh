#!/bin/bash

###############################################################################
# AI Installer 服务器自动配置脚本
#
# 用途: 自动配置新创建的 Ubuntu 服务器
# 执行方式:
#   1. 上传到服务器: scp scripts/provision-server.sh root@<SERVER_IP>:/root/
#   2. SSH 登录服务器: ssh root@<SERVER_IP>
#   3. 运行脚本: bash /root/provision-server.sh
#
# 功能:
#   - 更新系统
#   - 配置防火墙
#   - 安装 Docker 和 Docker Compose
#   - 配置自动安全更新
#   - 安装必要工具
#   - 系统优化
###############################################################################

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为 root 用户
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "请使用 root 用户运行此脚本"
        exit 1
    fi
}

# 检查操作系统
check_os() {
    log_info "检查操作系统..."

    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VER=$VERSION_ID
    else
        log_error "无法检测操作系统"
        exit 1
    fi

    if [ "$OS" != "ubuntu" ]; then
        log_error "此脚本仅支持 Ubuntu 系统"
        exit 1
    fi

    log_success "操作系统: Ubuntu $VER"
}

# 更新系统
update_system() {
    log_info "更新系统软件包..."

    export DEBIAN_FRONTEND=noninteractive

    apt-get update -y
    apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
    apt-get autoremove -y
    apt-get autoclean -y

    log_success "系统更新完成"
}

# 安装基础工具
install_basic_tools() {
    log_info "安装基础工具..."

    apt-get install -y \
        curl \
        wget \
        git \
        htop \
        vim \
        nano \
        net-tools \
        dnsutils \
        unzip \
        ca-certificates \
        gnupg \
        lsb-release \
        software-properties-common

    log_success "基础工具安装完成"
}

# 配置防火墙
setup_firewall() {
    log_info "配置防火墙..."

    # 安装 UFW
    apt-get install -y ufw

    # 重置防火墙规则
    ufw --force reset

    # 默认策略
    ufw default deny incoming
    ufw default allow outgoing

    # 允许 SSH
    ufw allow 22/tcp comment 'SSH'

    # 允许 HTTP/HTTPS
    ufw allow 80/tcp comment 'HTTP'
    ufw allow 443/tcp comment 'HTTPS'

    # 如果需要直接暴露 WebSocket 端口（通常不需要，使用 Nginx 反向代理）
    # ufw allow 3000/tcp comment 'WebSocket'

    # 启用防火墙
    ufw --force enable

    # 显示状态
    ufw status verbose

    log_success "防火墙配置完成"
}

# 安装 Docker
install_docker() {
    log_info "安装 Docker..."

    # 检查是否已安装
    if command -v docker &> /dev/null; then
        log_warning "Docker 已安装，跳过"
        docker --version
        return
    fi

    # 添加 Docker 官方 GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # 添加 Docker 仓库
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    # 更新软件包索引
    apt-get update -y

    # 安装 Docker Engine
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # 启动 Docker
    systemctl start docker
    systemctl enable docker

    # 验证安装
    docker --version
    docker compose version

    # 运行测试容器
    if docker run --rm hello-world &> /dev/null; then
        log_success "Docker 安装成功"
    else
        log_error "Docker 测试失败"
        exit 1
    fi
}

# 配置自动安全更新
setup_auto_updates() {
    log_info "配置自动安全更新..."

    apt-get install -y unattended-upgrades

    # 配置自动更新
    cat > /etc/apt/apt.conf.d/50unattended-upgrades <<EOF
Unattended-Upgrade::Allowed-Origins {
    "\${distro_id}:\${distro_codename}";
    "\${distro_id}:\${distro_codename}-security";
    "\${distro_id}ESMApps:\${distro_codename}-apps-security";
    "\${distro_id}ESM:\${distro_codename}-infra-security";
};

Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF

    # 启用自动更新
    cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

    log_success "自动安全更新配置完成"
}

# 系统优化
optimize_system() {
    log_info "优化系统配置..."

    # 优化 sysctl 参数
    cat >> /etc/sysctl.conf <<EOF

# AI Installer 优化参数
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.ip_local_port_range = 10000 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_tw_reuse = 1
vm.swappiness = 10
fs.file-max = 65535
EOF

    # 应用 sysctl 配置
    sysctl -p

    # 优化文件描述符限制
    cat >> /etc/security/limits.conf <<EOF

# AI Installer 文件描述符限制
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF

    log_success "系统优化完成"
}

# 创建项目目录
create_project_dirs() {
    log_info "创建项目目录..."

    mkdir -p /opt/aiinstaller
    mkdir -p /opt/aiinstaller/data
    mkdir -p /opt/aiinstaller/logs
    mkdir -p /opt/aiinstaller/backups

    log_success "项目目录创建完成"
}

# 配置时区
setup_timezone() {
    log_info "配置时区..."

    # 设置为 UTC（推荐）或 Asia/Tokyo
    timedatectl set-timezone UTC

    log_success "时区设置为 UTC"
}

# 生成服务器信息
generate_server_info() {
    log_info "生成服务器信息..."

    # 获取服务器信息
    HOSTNAME=$(hostname)
    IPV4=$(curl -s https://api.ipify.org || echo "N/A")
    IPV6=$(curl -s https://api6.ipify.org || echo "N/A")
    OS_INFO=$(lsb_release -d | cut -f2)
    KERNEL=$(uname -r)
    CPU_CORES=$(nproc)
    TOTAL_RAM=$(free -h | awk '/^Mem:/ {print $2}')
    DISK_SIZE=$(df -h / | awk 'NR==2 {print $2}')

    # 生成配置文件
    cat > /opt/aiinstaller/server-info.txt <<EOF
AI Installer 服务器信息
========================

服务器配置完成时间: $(date '+%Y-%m-%d %H:%M:%S %Z')

基本信息:
  主机名: $HOSTNAME
  IPv4 地址: $IPV4
  IPv6 地址: $IPV6

系统信息:
  操作系统: $OS_INFO
  内核版本: $KERNEL
  CPU 核心: $CPU_CORES
  总内存: $TOTAL_RAM
  磁盘大小: $DISK_SIZE

软件版本:
  Docker: $(docker --version 2>/dev/null || echo "未安装")
  Docker Compose: $(docker compose version 2>/dev/null || echo "未安装")

防火墙规则:
$(ufw status verbose | sed 's/^/  /')

下一步:
1. 配置域名 DNS: api.aiinstaller.dev -> $IPV4
2. 上传 docker-compose.yml 到 /opt/aiinstaller/
3. 配置环境变量 .env
4. 运行: cd /opt/aiinstaller && docker compose up -d
5. 配置 SSL 证书（Nginx + Let's Encrypt）

EOF

    cat /opt/aiinstaller/server-info.txt

    log_success "服务器信息已保存到: /opt/aiinstaller/server-info.txt"
}

# 主函数
main() {
    echo "========================================"
    echo "  AI Installer 服务器自动配置脚本"
    echo "========================================"
    echo ""

    check_root
    check_os

    echo ""
    log_info "开始配置服务器..."
    echo ""

    update_system
    install_basic_tools
    setup_firewall
    install_docker
    setup_auto_updates
    optimize_system
    create_project_dirs
    setup_timezone
    generate_server_info

    echo ""
    echo "========================================"
    log_success "服务器配置完成！"
    echo "========================================"
    echo ""
    echo "重要信息已保存到: /opt/aiinstaller/server-info.txt"
    echo ""
    echo "下一步:"
    echo "  1. 配置域名 DNS 解析"
    echo "  2. 上传 docker-compose.yml 和 .env"
    echo "  3. 启动服务: cd /opt/aiinstaller && docker compose up -d"
    echo ""

    # 询问是否重启
    read -p "是否现在重启服务器以应用所有更改? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "5 秒后重启服务器..."
        sleep 5
        reboot
    else
        log_warning "请稍后手动重启服务器: reboot"
    fi
}

# 执行主函数
main "$@"
