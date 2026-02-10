#!/bin/bash

###############################################################################
# 服务器健康检查脚本
#
# 用途: 检查服务器状态和配置是否符合要求
# 执行方式:
#   本地测试: bash scripts/health-check.sh --remote <SERVER_IP>
#   服务器上: bash scripts/health-check.sh
#
# 功能:
#   - 系统资源检查（CPU、内存、磁盘）
#   - 网络连通性检查
#   - 必要软件检查（Docker、Docker Compose）
#   - 防火墙规则检查
#   - 端口监听检查
#   - 服务状态检查
###############################################################################

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# 全局变量
REMOTE_MODE=false
REMOTE_HOST=""
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

# 解析参数
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --remote)
                REMOTE_MODE=true
                REMOTE_HOST="$2"
                shift 2
                ;;
            *)
                echo "未知参数: $1"
                echo "用法: $0 [--remote <SERVER_IP>]"
                exit 1
                ;;
        esac
    done
}

# 执行命令（支持远程）
exec_cmd() {
    if [ "$REMOTE_MODE" = true ]; then
        ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "root@$REMOTE_HOST" "$1" 2>/dev/null || echo "ERROR"
    else
        eval "$1" 2>/dev/null || echo "ERROR"
    fi
}

# 检查系统信息
check_system_info() {
    echo ""
    log_info "========================================"
    log_info "系统信息"
    log_info "========================================"

    local os_info
    os_info=$(exec_cmd "cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2")
    echo "  操作系统: $os_info"

    local kernel
    kernel=$(exec_cmd "uname -r")
    echo "  内核版本: $kernel"

    local hostname
    hostname=$(exec_cmd "hostname")
    echo "  主机名: $hostname"

    local uptime
    uptime=$(exec_cmd "uptime -p" | sed 's/up //')
    echo "  运行时间: $uptime"
}

# 检查 CPU
check_cpu() {
    ((TOTAL_CHECKS++))
    log_info "检查 CPU..."

    local cpu_cores
    cpu_cores=$(exec_cmd "nproc")

    if [ "$cpu_cores" == "ERROR" ]; then
        log_error "无法获取 CPU 信息"
        ((FAILED_CHECKS++))
        return 1
    fi

    echo "  CPU 核心数: $cpu_cores"

    if [ "$cpu_cores" -ge 2 ]; then
        log_success "CPU 核心数满足要求 (>= 2)"
        ((PASSED_CHECKS++))
    else
        log_warning "CPU 核心数不足，推荐至少 2 核心"
        ((WARNING_CHECKS++))
    fi
}

# 检查内存
check_memory() {
    ((TOTAL_CHECKS++))
    log_info "检查内存..."

    local mem_total
    mem_total=$(exec_cmd "free -m | awk 'NR==2 {print \$2}'")

    if [ "$mem_total" == "ERROR" ]; then
        log_error "无法获取内存信息"
        ((FAILED_CHECKS++))
        return 1
    fi

    local mem_used
    mem_used=$(exec_cmd "free -m | awk 'NR==2 {print \$3}'")

    local mem_free
    mem_free=$(exec_cmd "free -m | awk 'NR==2 {print \$4}'")

    local mem_percent=$((mem_used * 100 / mem_total))

    echo "  总内存: ${mem_total}MB"
    echo "  已使用: ${mem_used}MB (${mem_percent}%)"
    echo "  剩余: ${mem_free}MB"

    if [ "$mem_total" -ge 2048 ]; then
        log_success "内存容量满足要求 (>= 2GB)"
        ((PASSED_CHECKS++))
    elif [ "$mem_total" -ge 1024 ]; then
        log_warning "内存容量偏低，推荐至少 2GB"
        ((WARNING_CHECKS++))
    else
        log_error "内存容量不足，至少需要 1GB"
        ((FAILED_CHECKS++))
    fi

    if [ "$mem_percent" -gt 90 ]; then
        log_warning "内存使用率过高: ${mem_percent}%"
    fi
}

# 检查磁盘空间
check_disk() {
    ((TOTAL_CHECKS++))
    log_info "检查磁盘空间..."

    local disk_total
    disk_total=$(exec_cmd "df -BG / | awk 'NR==2 {print \$2}' | sed 's/G//'")

    if [ "$disk_total" == "ERROR" ]; then
        log_error "无法获取磁盘信息"
        ((FAILED_CHECKS++))
        return 1
    fi

    local disk_used
    disk_used=$(exec_cmd "df -BG / | awk 'NR==2 {print \$3}' | sed 's/G//'")

    local disk_avail
    disk_avail=$(exec_cmd "df -BG / | awk 'NR==2 {print \$4}' | sed 's/G//'")

    local disk_percent
    disk_percent=$(exec_cmd "df / | awk 'NR==2 {print \$5}' | sed 's/%//'")

    echo "  总容量: ${disk_total}GB"
    echo "  已使用: ${disk_used}GB (${disk_percent}%)"
    echo "  可用: ${disk_avail}GB"

    if [ "$disk_avail" -ge 20 ]; then
        log_success "磁盘空间充足 (>= 20GB 可用)"
        ((PASSED_CHECKS++))
    elif [ "$disk_avail" -ge 10 ]; then
        log_warning "磁盘空间偏低，建议保持 20GB 以上"
        ((WARNING_CHECKS++))
    else
        log_error "磁盘空间不足，至少需要 10GB"
        ((FAILED_CHECKS++))
    fi

    if [ "$disk_percent" -gt 80 ]; then
        log_warning "磁盘使用率过高: ${disk_percent}%"
    fi
}

# 检查网络连通性
check_network() {
    ((TOTAL_CHECKS++))
    log_info "检查网络连通性..."

    if [ "$REMOTE_MODE" = true ]; then
        if ping -c 3 -W 5 "$REMOTE_HOST" &>/dev/null; then
            log_success "可以 ping 通服务器: $REMOTE_HOST"
            ((PASSED_CHECKS++))
        else
            log_error "无法 ping 通服务器: $REMOTE_HOST"
            ((FAILED_CHECKS++))
        fi
    else
        # 测试外网连通性
        local test_hosts=("8.8.8.8" "1.1.1.1")
        local reachable=0

        for host in "${test_hosts[@]}"; do
            if exec_cmd "ping -c 1 -W 2 $host" | grep -q "1 received"; then
                ((reachable++))
            fi
        done

        if [ $reachable -eq ${#test_hosts[@]} ]; then
            log_success "网络连通正常"
            ((PASSED_CHECKS++))
        elif [ $reachable -gt 0 ]; then
            log_warning "部分网络测试失败"
            ((WARNING_CHECKS++))
        else
            log_error "网络不通"
            ((FAILED_CHECKS++))
        fi
    fi
}

# 检查 Docker
check_docker() {
    ((TOTAL_CHECKS++))
    log_info "检查 Docker..."

    local docker_version
    docker_version=$(exec_cmd "docker --version 2>/dev/null")

    if [ "$docker_version" == "ERROR" ] || [ -z "$docker_version" ]; then
        log_error "Docker 未安装"
        ((FAILED_CHECKS++))
        return 1
    fi

    echo "  $docker_version"

    # 检查 Docker 服务状态
    local docker_status
    docker_status=$(exec_cmd "systemctl is-active docker 2>/dev/null")

    if [ "$docker_status" == "active" ]; then
        log_success "Docker 已安装并运行"
        ((PASSED_CHECKS++))
    else
        log_error "Docker 已安装但未运行"
        ((FAILED_CHECKS++))
    fi
}

# 检查 Docker Compose
check_docker_compose() {
    ((TOTAL_CHECKS++))
    log_info "检查 Docker Compose..."

    local compose_version
    compose_version=$(exec_cmd "docker compose version 2>/dev/null")

    if [ "$compose_version" == "ERROR" ] || [ -z "$compose_version" ]; then
        log_error "Docker Compose 未安装"
        ((FAILED_CHECKS++))
        return 1
    fi

    echo "  $compose_version"
    log_success "Docker Compose 已安装"
    ((PASSED_CHECKS++))
}

# 检查防火墙
check_firewall() {
    ((TOTAL_CHECKS++))
    log_info "检查防火墙..."

    local ufw_status
    ufw_status=$(exec_cmd "ufw status 2>/dev/null | head -1")

    if [ "$ufw_status" == "ERROR" ]; then
        log_warning "UFW 未安装或无法访问"
        ((WARNING_CHECKS++))
        return 1
    fi

    if echo "$ufw_status" | grep -q "Status: active"; then
        log_success "防火墙已启用"
        ((PASSED_CHECKS++))

        # 检查必要端口
        local required_ports=("22" "80" "443")
        for port in "${required_ports[@]}"; do
            local rule_check
            rule_check=$(exec_cmd "ufw status | grep -E '${port}/(tcp|any)'")

            if [ "$rule_check" != "ERROR" ] && [ -n "$rule_check" ]; then
                echo "  ✓ 端口 $port 已开放"
            else
                log_warning "端口 $port 可能未开放"
            fi
        done
    else
        log_warning "防火墙未启用"
        ((WARNING_CHECKS++))
    fi
}

# 检查端口监听
check_ports() {
    ((TOTAL_CHECKS++))
    log_info "检查端口监听..."

    # 检查常用端口
    local ports_to_check=("22:SSH" "80:HTTP" "443:HTTPS")
    local listening_count=0

    for port_info in "${ports_to_check[@]}"; do
        IFS=':' read -r port service <<< "$port_info"

        local listen_check
        listen_check=$(exec_cmd "ss -tuln | grep ':${port} ' 2>/dev/null")

        if [ "$listen_check" != "ERROR" ] && [ -n "$listen_check" ]; then
            echo "  ✓ $service (端口 $port) 正在监听"
            ((listening_count++))
        else
            echo "  ✗ $service (端口 $port) 未监听"
        fi
    done

    if [ $listening_count -gt 0 ]; then
        log_success "$listening_count 个端口正在监听"
        ((PASSED_CHECKS++))
    else
        log_warning "没有检测到监听的端口"
        ((WARNING_CHECKS++))
    fi
}

# 检查项目目录
check_project_dirs() {
    ((TOTAL_CHECKS++))
    log_info "检查项目目录..."

    local required_dirs=("/opt/aiinstaller")
    local dirs_exist=0

    for dir in "${required_dirs[@]}"; do
        local dir_check
        dir_check=$(exec_cmd "test -d $dir && echo 'exists' || echo 'not_exists'")

        if [ "$dir_check" == "exists" ]; then
            echo "  ✓ $dir 存在"
            ((dirs_exist++))
        else
            echo "  ✗ $dir 不存在"
        fi
    done

    if [ $dirs_exist -eq ${#required_dirs[@]} ]; then
        log_success "所有项目目录已创建"
        ((PASSED_CHECKS++))
    else
        log_warning "部分项目目录不存在"
        ((WARNING_CHECKS++))
    fi
}

# 生成报告
generate_report() {
    echo ""
    log_info "========================================"
    log_info "健康检查报告"
    log_info "========================================"
    echo ""

    local total=$((PASSED_CHECKS + FAILED_CHECKS + WARNING_CHECKS))
    local pass_percent=0

    if [ $total -gt 0 ]; then
        pass_percent=$((PASSED_CHECKS * 100 / total))
    fi

    echo "  总检查项: $TOTAL_CHECKS"
    echo "  通过: $PASSED_CHECKS ($(echo "scale=1; $PASSED_CHECKS * 100 / $TOTAL_CHECKS" | bc)%)"
    echo "  警告: $WARNING_CHECKS"
    echo "  失败: $FAILED_CHECKS"
    echo ""

    if [ $FAILED_CHECKS -eq 0 ] && [ $WARNING_CHECKS -eq 0 ]; then
        log_success "所有检查通过！服务器状态良好"
        return 0
    elif [ $FAILED_CHECKS -eq 0 ]; then
        log_warning "所有关键检查通过，但有 $WARNING_CHECKS 个警告"
        return 1
    else
        log_error "有 $FAILED_CHECKS 个检查失败，请修复后重试"
        return 2
    fi
}

# 主函数
main() {
    parse_args "$@"

    echo "========================================"
    echo "  AI Installer 服务器健康检查"
    echo "========================================"

    if [ "$REMOTE_MODE" = true ]; then
        log_info "远程检查模式: $REMOTE_HOST"
    else
        log_info "本地检查模式"
    fi

    check_system_info

    echo ""
    log_info "========================================"
    log_info "开始健康检查..."
    log_info "========================================"

    check_cpu
    check_memory
    check_disk
    check_network
    check_docker
    check_docker_compose
    check_firewall
    check_ports
    check_project_dirs

    generate_report
    local exit_code=$?

    echo ""

    if [ $exit_code -eq 0 ]; then
        log_info "下一步: 部署应用"
        echo "  cd /opt/aiinstaller"
        echo "  docker compose up -d"
    elif [ $exit_code -eq 1 ]; then
        log_info "建议检查警告项，但可以继续部署"
    else
        log_info "请先解决失败的检查项"
    fi

    exit $exit_code
}

# 执行主函数
main "$@"
