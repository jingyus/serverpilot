#!/bin/bash
#
# 查看 ServerPilot 自动化开发实时日志
# 用法: ./logs.sh
#

# 获取脚本所在目录的上级目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# 日志文件
LOG_FILE="$PROJECT_DIR/dev.log"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       ServerPilot 开发日志实时查看                         ║${NC}"
echo -e "${CYAN}║       AI 驱动的智能运维平台                                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 检查日志文件是否存在
if [ ! -f "$LOG_FILE" ]; then
    echo -e "${RED}❌ dev.log 不存在${NC}"
    echo -e "${YELLOW}提示: 运行 ./dev.sh start 后会生成日志文件${NC}"
    echo ""
    exit 1
fi

# 检查脚本是否在运行
if ps aux | grep -q "[r]un.sh"; then
    echo -e "${GREEN}🟢 run.sh 运行中${NC}"
else
    echo -e "${YELLOW}🟡 run.sh 未运行（查看历史日志）${NC}"
fi

echo -e "${BLUE}📋 实时日志输出（按 Ctrl+C 退出）${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 实时跟踪日志，带颜色
tail -f "$LOG_FILE" | while read line; do
    # 根据日志级别添加颜色
    if echo "$line" | grep -q "SUCCESS"; then
        echo -e "${GREEN}$line${NC}"
    elif echo "$line" | grep -q "ERROR"; then
        echo -e "${RED}$line${NC}"
    elif echo "$line" | grep -q "WARNING"; then
        echo -e "${YELLOW}$line${NC}"
    elif echo "$line" | grep -q "TASK"; then
        echo -e "${PURPLE}$line${NC}"
    elif echo "$line" | grep -q "INFO"; then
        echo -e "${BLUE}$line${NC}"
    else
        echo "$line"
    fi
done
