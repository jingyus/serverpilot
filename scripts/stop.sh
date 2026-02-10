#!/bin/bash
#
# 停止 ServerPilot 自动化开发脚本
# 用法: ./stop.sh
#

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       ServerPilot 停止自动化开发                           ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}正在查找运行中的 run.sh 进程...${NC}"

# 查找 run.sh 进程
PIDS=$(ps aux | grep "[r]un.sh" | awk '{print $2}')

if [ -z "$PIDS" ]; then
    echo -e "${GREEN}✅ run.sh 未在运行${NC}"
    echo ""
    exit 0
fi

echo -e "${YELLOW}找到进程: $PIDS${NC}"
echo ""

# 优雅停止
echo -e "${YELLOW}发送停止信号 (SIGTERM)...${NC}"
for pid in $PIDS; do
    kill $pid 2>/dev/null && echo -e "${GREEN}✓ 已停止进程 $pid${NC}"
done

# 等待进程退出
sleep 2

# 检查是否还在运行
REMAINING=$(ps aux | grep "[r]un.sh" | awk '{print $2}')

if [ -n "$REMAINING" ]; then
    echo ""
    echo -e "${RED}部分进程未响应，强制终止...${NC}"
    for pid in $REMAINING; do
        kill -9 $pid 2>/dev/null && echo -e "${GREEN}✓ 强制停止进程 $pid${NC}"
    done
fi

# 同时停止可能存在的 claude 进程
CLAUDE_PIDS=$(ps aux | grep "[c]laude" | awk '{print $2}')
if [ -n "$CLAUDE_PIDS" ]; then
    echo ""
    echo -e "${YELLOW}停止相关 Claude 进程...${NC}"
    for pid in $CLAUDE_PIDS; do
        kill $pid 2>/dev/null && echo -e "${GREEN}✓ 已停止 Claude 进程 $pid${NC}"
    done
fi

echo ""
echo -e "${GREEN}✅ ServerPilot 自动化开发已停止${NC}"
echo ""
