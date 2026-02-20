#!/bin/bash
#
# Cloud 功能自动开发 - 快速启动脚本
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

clear

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║    ServerPilot Cloud 功能自动开发${NC}"
echo -e "${CYAN}║    AI-Driven Development for Cloud Features${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# 检查文档
if [ ! -f "$PROJECT_DIR/CLOUD_AUTO_DEV.md" ]; then
    echo -e "${RED}[ERROR]${NC} 缺少使用文档: CLOUD_AUTO_DEV.md"
    exit 1
fi

echo -e "${BLUE}📖 使用说明文档${NC}"
echo -e "   文件: ${GREEN}CLOUD_AUTO_DEV.md${NC}"
echo -e "   建议先阅读文档了解工作流程"
echo ""

# 显示开发优先级
echo -e "${YELLOW}🎯 开发优先级${NC}"
echo ""
echo -e "${GREEN}P0（核心价值，10天内完成）${NC}"
echo "   1. AI 配额管理（3 天）"
echo "   2. Stripe 计费集成（5 天）"
echo "   3. Agent 连接认证增强（2 天）"
echo ""
echo -e "${BLUE}P1（重要功能，9天内完成）${NC}"
echo "   4. 用户注册流程改造（3 天）"
echo "   5. 使用量仪表盘（3 天）"
echo "   6. Dashboard 多租户隔离（2 天）"
echo ""

# 显示日志文件位置
echo -e "${YELLOW}📝 日志文件${NC}"
echo "   执行日志: autorun_cloud.log"
echo "   任务队列: CLOUD_TASK_QUEUE.md"
echo "   当前任务: CURRENT_CLOUD_TASK.md"
echo "   Token 统计: CLOUD_TOKEN_USAGE.log"
echo ""

# 显示安全约束
echo -e "${RED}🔒 安全约束${NC}"
echo "   ✅ 只修改: packages/cloud/ 目录"
echo "   ❌ 禁止修改: packages/server/, packages/agent/, packages/dashboard/"
echo ""

# 显示快捷命令
echo -e "${CYAN}⌨️  快捷命令${NC}"
echo "   查看任务状态:   ./scripts/autorun_cloud.sh --status"
echo "   查看失败任务:   ./scripts/autorun_cloud.sh --show-failures"
echo "   重置失败任务:   ./scripts/autorun_cloud.sh --reset-failures"
echo "   停止开发:       按 Ctrl+C"
echo ""

# 环境变量配置
echo -e "${YELLOW}⚙️  环境变量配置${NC}"
echo "   循环间隔: INTERVAL=${INTERVAL:-30}秒"
echo "   最大重试: MAX_RETRIES=${MAX_RETRIES:-3}次"
echo "   Token 限制: MAX_TOKENS=${MAX_TOKENS:-10000000}"
echo ""

# 确认启动
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
read -p "是否启动自动开发？(y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${BLUE}[INFO]${NC} 已取消启动"
    echo ""
    exit 0
fi

echo ""
echo -e "${GREEN}[OK]${NC} 启动 Cloud 功能自动开发..."
echo ""
sleep 1

# 启动自动开发脚本
exec "$SCRIPT_DIR/autorun_cloud.sh"
