#!/bin/bash

###############################################################################
# DNS 配置检查脚本
#
# 用途: 验证域名 DNS 解析是否正确配置
# 执行方式: bash scripts/check-dns.sh <domain> <expected_ip>
#
# 示例:
#   bash scripts/check-dns.sh api.aiinstaller.dev 123.45.67.89
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
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查参数
if [ $# -lt 2 ]; then
    echo "用法: $0 <domain> <expected_ip>"
    echo "示例: $0 api.aiinstaller.dev 123.45.67.89"
    exit 1
fi

DOMAIN=$1
EXPECTED_IP=$2

echo "========================================"
echo "  DNS 配置检查工具"
echo "========================================"
echo ""
log_info "目标域名: $DOMAIN"
log_info "期望 IP: $EXPECTED_IP"
echo ""

# 检查必要工具
check_tools() {
    local missing_tools=()

    if ! command -v dig &> /dev/null; then
        missing_tools+=("dig")
    fi

    if ! command -v nslookup &> /dev/null; then
        missing_tools+=("nslookup")
    fi

    if ! command -v ping &> /dev/null; then
        missing_tools+=("ping")
    fi

    if [ ${#missing_tools[@]} -gt 0 ]; then
        log_warning "缺少工具: ${missing_tools[*]}"
        log_info "尝试安装..."

        if [[ "$OSTYPE" == "darwin"* ]]; then
            log_info "macOS 系统，工具应该已预装"
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            sudo apt-get update -qq
            sudo apt-get install -y -qq dnsutils iputils-ping
        fi
    fi
}

# 使用 dig 查询 DNS
check_with_dig() {
    log_info "使用 dig 查询 DNS..."

    if ! command -v dig &> /dev/null; then
        log_warning "dig 未安装，跳过"
        return
    fi

    local result
    result=$(dig +short "$DOMAIN" A | grep -v '\.$' | head -1)

    if [ -z "$result" ]; then
        log_error "dig: 无法解析域名"
        return 1
    fi

    echo "  解析结果: $result"

    if [ "$result" == "$EXPECTED_IP" ]; then
        log_success "dig: DNS 解析正确"
        return 0
    else
        log_error "dig: IP 不匹配 (期望: $EXPECTED_IP, 实际: $result)"
        return 1
    fi
}

# 使用 nslookup 查询 DNS
check_with_nslookup() {
    log_info "使用 nslookup 查询 DNS..."

    if ! command -v nslookup &> /dev/null; then
        log_warning "nslookup 未安装，跳过"
        return
    fi

    local result
    result=$(nslookup "$DOMAIN" 2>/dev/null | grep 'Address:' | tail -1 | awk '{print $2}')

    if [ -z "$result" ]; then
        log_error "nslookup: 无法解析域名"
        return 1
    fi

    echo "  解析结果: $result"

    if [ "$result" == "$EXPECTED_IP" ]; then
        log_success "nslookup: DNS 解析正确"
        return 0
    else
        log_error "nslookup: IP 不匹配 (期望: $EXPECTED_IP, 实际: $result)"
        return 1
    fi
}

# 使用 ping 测试连通性
check_with_ping() {
    log_info "使用 ping 测试连通性..."

    if ! command -v ping &> /dev/null; then
        log_warning "ping 未安装，跳过"
        return
    fi

    local ping_result
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        ping_result=$(ping -c 3 -W 5000 "$DOMAIN" 2>&1)
    else
        # Linux
        ping_result=$(ping -c 3 -W 5 "$DOMAIN" 2>&1)
    fi

    if echo "$ping_result" | grep -q "0% packet loss"; then
        local avg_time
        avg_time=$(echo "$ping_result" | grep 'avg' | awk -F'/' '{print $5}')
        log_success "ping: 服务器可访问 (平均延迟: ${avg_time}ms)"

        # 检查 ping 到的 IP 是否正确
        local pinged_ip
        pinged_ip=$(echo "$ping_result" | grep 'PING' | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)

        if [ -n "$pinged_ip" ]; then
            echo "  Ping 到的 IP: $pinged_ip"
            if [ "$pinged_ip" == "$EXPECTED_IP" ]; then
                log_success "ping: IP 地址匹配"
            else
                log_warning "ping: IP 不匹配 (期望: $EXPECTED_IP, 实际: $pinged_ip)"
            fi
        fi
        return 0
    else
        log_error "ping: 服务器不可访问或丢包"
        return 1
    fi
}

# 使用多个公共 DNS 服务器查询
check_with_multiple_dns() {
    log_info "使用多个公共 DNS 服务器查询..."

    if ! command -v dig &> /dev/null; then
        log_warning "dig 未安装，跳过多 DNS 查询"
        return
    fi

    local dns_servers=(
        "8.8.8.8:Google"
        "1.1.1.1:Cloudflare"
        "208.67.222.222:OpenDNS"
    )

    local success_count=0
    local total_count=${#dns_servers[@]}

    for dns_entry in "${dns_servers[@]}"; do
        IFS=':' read -r dns_ip dns_name <<< "$dns_entry"

        local result
        result=$(dig +short @"$dns_ip" "$DOMAIN" A | grep -v '\.$' | head -1 2>/dev/null || echo "")

        if [ -z "$result" ]; then
            echo "  $dns_name ($dns_ip): 无法解析"
        elif [ "$result" == "$EXPECTED_IP" ]; then
            echo "  $dns_name ($dns_ip): ✅ $result"
            ((success_count++))
        else
            echo "  $dns_name ($dns_ip): ❌ $result (期望: $EXPECTED_IP)"
        fi
    done

    if [ $success_count -eq $total_count ]; then
        log_success "所有 DNS 服务器解析一致"
    elif [ $success_count -gt 0 ]; then
        log_warning "$success_count/$total_count DNS 服务器解析正确 (DNS 可能正在传播)"
    else
        log_error "所有 DNS 服务器解析失败"
    fi
}

# 检查 DNS 传播状态
check_dns_propagation() {
    log_info "检查全球 DNS 传播状态..."

    # 使用 whatsmydns.net API
    log_info "访问: https://www.whatsmydns.net/#A/$DOMAIN"
    echo "  请在浏览器中手动检查全球 DNS 传播状态"
}

# 生成 DNS 配置示例
show_dns_config_example() {
    echo ""
    log_info "DNS 配置示例:"
    echo ""
    echo "Cloudflare DNS 记录:"
    echo "  类型: A"
    echo "  名称: $(echo $DOMAIN | cut -d'.' -f1)"
    echo "  内容: $EXPECTED_IP"
    echo "  代理: 是（推荐，提供 CDN 和 DDoS 防护）"
    echo "  TTL: 自动"
    echo ""
    echo "如果使用域名注册商 DNS:"
    echo "  类型: A"
    echo "  主机记录: $(echo $DOMAIN | cut -d'.' -f1)"
    echo "  记录值: $EXPECTED_IP"
    echo "  TTL: 600"
    echo ""
}

# 主函数
main() {
    check_tools

    local test_passed=0
    local test_failed=0

    # 运行各项测试
    if check_with_dig; then
        ((test_passed++))
    else
        ((test_failed++))
    fi

    echo ""

    if check_with_nslookup; then
        ((test_passed++))
    else
        ((test_failed++))
    fi

    echo ""

    if check_with_ping; then
        ((test_passed++))
    else
        ((test_failed++))
    fi

    echo ""

    check_with_multiple_dns

    echo ""

    check_dns_propagation

    echo ""
    echo "========================================"
    echo "  检查结果"
    echo "========================================"
    echo "  通过测试: $test_passed"
    echo "  失败测试: $test_failed"
    echo ""

    if [ $test_failed -eq 0 ]; then
        log_success "所有检查通过！DNS 配置正确"
        echo ""
        exit 0
    elif [ $test_passed -gt 0 ]; then
        log_warning "部分检查通过，DNS 可能正在传播中"
        echo ""
        log_info "DNS 传播通常需要 10 分钟到 48 小时"
        log_info "请稍后重新运行此脚本进行检查"
        echo ""
        show_dns_config_example
        exit 2
    else
        log_error "所有检查失败，请检查 DNS 配置"
        echo ""
        show_dns_config_example
        exit 1
    fi
}

# 执行主函数
main
