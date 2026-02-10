#!/bin/bash
#
# ServerPilot 自动化开发实时监控脚本
# 用法: ./watch.sh
#

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# 文件路径
TODO_FILE="$PROJECT_DIR/docs/TODO.md"
LOG_FILE="$PROJECT_DIR/dev.log"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

while true; do
    clear

    # 标题
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       ServerPilot 自动化开发实时监控                        ║${NC}"
    echo -e "${CYAN}║       AI 驱动的智能运维平台                                 ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 检查脚本是否在运行
    if ps aux | grep -q "[r]un.sh"; then
        echo -e "${GREEN}🟢 状态: 运行中${NC}"
    else
        echo -e "${YELLOW}🟡 状态: 未运行${NC}"
    fi
    echo ""

    # 进度统计
    if [ -f "$TODO_FILE" ]; then
        pending=$(grep -c "⬜ 待开发" "$TODO_FILE" 2>/dev/null || echo "0")
        completed=$(grep -c "✅ 完成" "$TODO_FILE" 2>/dev/null || echo "0")
        in_progress=$(grep -c "🔄 进行中" "$TODO_FILE" 2>/dev/null || echo "0")

        pending=${pending:-0}
        completed=${completed:-0}
        in_progress=${in_progress:-0}

        total=$((pending + completed + in_progress))

        if [ $total -gt 0 ]; then
            percentage=$((completed * 100 / total))
        else
            percentage=0
        fi

        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${CYAN}📊 总体进度${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "  ✅ 已完成: ${GREEN}$completed${NC} 个任务"
        echo -e "  🔄 进行中: ${BLUE}$in_progress${NC} 个任务"
        echo -e "  ⬜ 待完成: ${YELLOW}$pending${NC} 个任务"
        echo -e "  📈 进度: ${PURPLE}$percentage%${NC}"
        echo ""
    fi

    # Phase 进度
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🎯 阶段进度${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  Phase 1: MVP 核心闭环 (6周)     ${YELLOW}[进行中]${NC}"
    echo -e "  Phase 2: 安全与体验 (4周)       ${BLUE}[待开发]${NC}"
    echo -e "  Phase 3: 开源发布 (4周)         ${BLUE}[待开发]${NC}"
    echo -e "  Phase 4: 云版发布 (4周)         ${BLUE}[待开发]${NC}"
    echo ""

    # 当前任务
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🔥 当前任务${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -f "$TODO_FILE" ]; then
        # 获取第一个待开发任务
        current=$(grep "⬜ 待开发" "$TODO_FILE" 2>/dev/null | head -1)
        if [ -n "$current" ]; then
            task_name=$(echo "$current" | cut -d'|' -f2 | xargs)
            task_desc=$(echo "$current" | cut -d'|' -f5 | xargs)
            echo -e "  ${YELLOW}▶${NC} $task_name"
            if [ -n "$task_desc" ]; then
                echo -e "    ${BLUE}$task_desc${NC}"
            fi
        else
            echo -e "  ${GREEN}所有任务已完成！${NC}"
        fi
    else
        echo "  暂无数据"
    fi
    echo ""

    # 最近完成的任务
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}✅ 最近完成的任务 (最新5个)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -f "$TODO_FILE" ]; then
        grep "✅ 完成" "$TODO_FILE" 2>/dev/null | tail -5 | while read line; do
            task=$(echo "$line" | cut -d'|' -f2 | xargs)
            if [ -n "$task" ]; then
                echo -e "  ${GREEN}✓${NC} $task"
            fi
        done
    else
        echo "  暂无数据"
    fi
    echo ""

    # 最新日志
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}📋 开发日志 (最新10行)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -f "$LOG_FILE" ]; then
        tail -10 "$LOG_FILE" 2>/dev/null | while read line; do
            # 根据日志级别添加颜色
            if echo "$line" | grep -q "SUCCESS"; then
                echo -e "${GREEN}$line${NC}"
            elif echo "$line" | grep -q "ERROR"; then
                echo -e "${RED}$line${NC}"
            elif echo "$line" | grep -q "WARNING"; then
                echo -e "${YELLOW}$line${NC}"
            elif echo "$line" | grep -q "TASK"; then
                echo -e "${PURPLE}$line${NC}"
            else
                echo "$line"
            fi
        done
    else
        echo "  暂无日志"
    fi
    echo ""

    # 底部信息
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  更新时间: ${BLUE}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo -e "  ${YELLOW}按 Ctrl+C 退出监控${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # 每5秒刷新一次
    sleep 5
done
