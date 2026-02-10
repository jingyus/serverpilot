#!/bin/bash
#
# ServerPilot 快捷启动脚本
# 用法: ./dev.sh [command]
#
# 命令:
#   start  - 启动自动化开发
#   stop   - 停止自动化开发
#   logs   - 查看实时日志
#   watch  - 查看进度监控
#   build  - 构建项目
#   test   - 运行测试
#   help   - 显示帮助
#

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# 颜色定义
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 显示帮助
show_help() {
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       ServerPilot 自动化开发系统                            ║${NC}"
    echo -e "${CYAN}║       AI 驱动的智能运维平台                                 ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "用法: ./dev.sh [command]"
    echo ""
    echo "开发命令:"
    echo "  ${GREEN}start${NC}   - 启动自动化开发 (Claude Code 自动执行任务)"
    echo "  ${GREEN}stop${NC}    - 停止自动化开发"
    echo "  ${GREEN}logs${NC}    - 查看实时日志"
    echo "  ${GREEN}watch${NC}   - 查看进度监控面板"
    echo ""
    echo "构建命令:"
    echo "  ${GREEN}build${NC}   - 构建所有包"
    echo "  ${GREEN}test${NC}    - 运行测试"
    echo "  ${GREEN}dev${NC}     - 启动开发服务器"
    echo ""
    echo "其他:"
    echo "  ${GREEN}help${NC}    - 显示此帮助"
    echo ""
    echo "示例:"
    echo "  ./dev.sh start    # 启动自动化开发"
    echo "  ./dev.sh watch    # 查看进度监控"
    echo "  ./dev.sh build    # 构建项目"
    echo ""
    echo -e "${BLUE}项目文档:${NC}"
    echo "  docs/TODO.md                    - 任务清单"
    echo "  docs/SERVERPILOT技术方案.md     - 技术方案"
    echo "  docs/DevOps产品方案.md          - 产品方案"
    echo "  docs/开发标准.md                - 开发标准"
    echo ""
}

# 构建项目
do_build() {
    echo -e "${CYAN}正在构建项目...${NC}"
    if command -v pnpm &> /dev/null; then
        pnpm build
    else
        npm run build
    fi
}

# 运行测试
do_test() {
    echo -e "${CYAN}正在运行测试...${NC}"
    if command -v pnpm &> /dev/null; then
        pnpm test
    else
        npm test
    fi
}

# 启动开发服务器
do_dev() {
    echo -e "${CYAN}正在启动开发服务器...${NC}"
    if command -v pnpm &> /dev/null; then
        pnpm dev
    else
        npm run dev
    fi
}

# 主逻辑
case "$1" in
    start)
        exec "$SCRIPT_DIR/run.sh"
        ;;
    stop)
        exec "$SCRIPT_DIR/stop.sh"
        ;;
    logs)
        exec "$SCRIPT_DIR/logs.sh"
        ;;
    watch)
        exec "$SCRIPT_DIR/watch.sh"
        ;;
    build)
        do_build
        ;;
    test)
        do_test
        ;;
    dev)
        do_dev
        ;;
    help|--help|-h)
        show_help
        ;;
    "")
        echo -e "${YELLOW}⚠️  请指定命令${NC}"
        show_help
        exit 1
        ;;
    *)
        echo -e "${YELLOW}⚠️  未知命令: $1${NC}"
        show_help
        exit 1
        ;;
esac
