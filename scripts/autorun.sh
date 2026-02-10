#!/bin/bash
#
# ServerPilot AI 自循环开发脚本
# AI 自动分析 -> 生成任务 -> 实现 -> 测试 -> 循环
#
# 用法: ./autorun.sh
#
# 工作流程:
# 1. AI 阅读技术方案文档，分析当前代码完成度
# 2. AI 自动生成下一个待完成任务
# 3. AI 自动实现功能
# 4. 运行测试验证
# 5. 等待30秒后继续循环
#

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 项目目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# 文件路径
PRODUCT_GUIDE="$PROJECT_DIR/docs/产品方案-目录.md"  # 精简版产品方案
PRODUCT_DOC="$PROJECT_DIR/docs/DevOps产品方案.md"   # 完整产品方案
DEV_STANDARD="$PROJECT_DIR/docs/开发标准.md"        # 开发标准
LOG_FILE="$PROJECT_DIR/autorun.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_TASK.md"
TEST_LOG="$PROJECT_DIR/test.log"

# 配置
INTERVAL=30            # 循环间隔（秒）
MAX_ITERATIONS=1000    # 最大迭代次数
ANALYZE_TIMEOUT=3600   # 分析阶段超时（30分钟）
EXECUTE_TIMEOUT=3600   # 执行阶段超时（30分钟）
MAX_RETRIES=3          # 单任务最大重试次数

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO: $1" >> "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $1" >> "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >> "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1" >> "$LOG_FILE"
}

log_task() {
    echo -e "${PURPLE}[TASK]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] TASK: $1" >> "$LOG_FILE"
}

log_ai() {
    echo -e "${CYAN}[AI]${NC} $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] AI: $1" >> "$LOG_FILE"
}

# 检查环境
check_environment() {
    log_info "检查开发环境..."

    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装"
        exit 1
    fi
    log_success "Node.js: $(node --version)"

    # 检查 pnpm
    if ! command -v pnpm &> /dev/null; then
        log_warning "pnpm 未安装，正在安装..."
        npm install -g pnpm
    fi
    log_success "pnpm: $(pnpm --version)"

    # 检查 Claude Code
    if ! command -v claude &> /dev/null; then
        log_error "Claude Code CLI 未安装"
        log_error "请访问 https://claude.ai/code 安装 Claude Code"
        exit 1
    fi
    log_success "Claude Code 已安装"

    # 检查产品方案目录（精简版）
    if [ ! -f "$PRODUCT_GUIDE" ]; then
        log_error "产品方案目录不存在: $PRODUCT_GUIDE"
        exit 1
    fi
    log_success "产品方案目录: $PRODUCT_GUIDE"

    # 检查完整产品方案
    if [ ! -f "$PRODUCT_DOC" ]; then
        log_warning "完整产品方案不存在: $PRODUCT_DOC"
    else
        log_success "完整产品方案: $PRODUCT_DOC"
    fi

    # 检查开发标准文档
    if [ ! -f "$DEV_STANDARD" ]; then
        log_warning "开发标准文档不存在: $DEV_STANDARD"
    else
        log_success "开发标准文档: $DEV_STANDARD"
    fi
}

# 初始化状态文件
init_state_file() {
    if [ ! -f "$STATE_FILE" ]; then
        cat > "$STATE_FILE" << 'EOF'
# ServerPilot AI 自循环开发状态

> 此文件记录 AI 自动开发的进度和历史

---

## 开发日志

EOF
    fi
}

# 记录状态
record_state() {
    local iteration="$1"
    local task="$2"
    local status="$3"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    init_state_file

    cat >> "$STATE_FILE" << EOF

### [$timestamp] 第 $iteration 轮

**任务**: $task

**状态**: $status

---

EOF
}

# 构建分析Prompt - 让AI分析当前进度并生成任务
build_analyze_prompt() {
    cat << 'EOF'
你是 ServerPilot 项目的 AI 开发助手。请分析项目当前状态并决定下一步工作。

## 项目目标

**产品方案**: docs/产品方案-目录.md - MVP 范围、优先级、技术栈概要
**完整方案**: docs/DevOps产品方案.md - 详细产品设计（需要时查阅）
**开发标准**: docs/开发标准.md - 技术架构、代码规范、Git 工作流、测试标准

## 你的任务

1. **阅读产品方案目录**: 先读 docs/产品方案-目录.md，了解 MVP 范围和开发优先级
2. **遵循开发标准**: 查看 docs/开发标准.md，了解技术架构和代码规范
3. **分析当前代码**: 检查 packages/ 目录下各模块的实现状态
4. **确定下一个任务**: 根据"产品方案-目录.md"中的开发优先级，选择一个最重要的任务
5. **生成任务描述**: 输出一个明确的任务描述

**注意**:
- 优先完成 MVP (v0.1) 范围内的功能，按照"第一优先级 → 第二优先级 → 第三优先级"顺序开发
- 必须遵守开发标准中的代码规范、命名规则、Git 提交规范

## 输出格式

请在分析完成后，输出以下格式的任务（必须严格遵循）：

```task
任务名称: [具体任务名]
模块路径: [如 packages/server/src/core/session/]
任务描述: [详细说明要实现什么功能]
产品需求: [对应产品方案中的哪个功能点]
验收标准: [如何验证任务完成]
```

## 优先级规则

1. **MVP 优先**: 先完成产品方案中 MVP 范围内的核心功能
2. **基础设施**: 数据库、配置、日志等基础模块
3. **核心模块**: AI对话引擎、服务器档案、任务执行
4. **通信层**: WebSocket 通信、REST API
5. **用户界面**: Dashboard Web界面
6. 标记 ✅ 的模块跳过，标记 "待开发" 的优先处理

## 注意事项

- 每次只选择一个最重要的任务
- 任务粒度要适中（1-2小时可完成）
- 优先选择有依赖关系的底层模块
- 确保任务与产品方案的功能需求对应
- 任务描述要清晰，可独立执行

开始分析项目...
EOF
}

# 构建执行Prompt - 让AI执行具体任务
build_execute_prompt() {
    local task_content="$1"

    cat << EOF
你正在开发 ServerPilot 项目 - 一个 AI 驱动的智能运维平台。

## 项目目标
**产品方案**: docs/产品方案-目录.md - MVP 范围、优先级、技术栈
**开发标准**: docs/开发标准.md - 技术架构、代码规范、Git 工作流、测试标准

## 项目信息
- **技术栈**: Node.js 22+ / TypeScript / Hono / React / Drizzle ORM / SQLite
- **架构**: Monorepo (packages/server, packages/agent, packages/dashboard, packages/shared)
- **当前阶段**: MVP v0.1 - 核心闭环 (6周)

## 当前任务
$task_content

## 开发要求

1. **对照产品方案**: 确保实现符合 docs/产品方案-目录.md 中的 MVP 范围
2. **遵循开发标准**: 严格按照 docs/开发标准.md 中的规范执行：
   - 技术架构：分层架构、模块职责、技术栈选型
   - 代码规范：TypeScript strict mode、命名规则、文件结构
   - 测试标准：安全模块 ≥95%、AI 模块 ≥90%、整体 ≥80%
   - Git 规范：分支命名、Commit Message 格式
   - 安全边界：五层纵深防御、命令分级制度
4. **代码质量**:
   - 使用 TypeScript，确保类型安全
   - 使用 Zod 进行数据验证
   - 遵循项目现有代码风格
   - 单文件不超过 500 行（硬限制 800 行）
5. **编写测试**: 为新功能编写单元测试，确保覆盖率达标
6. **增量开发**: 只实现当前任务，不要过度设计

## 安全规则
- 不执行破坏性命令
- 不暴露敏感信息
- 所有外部输入都要验证

开始执行任务。完成后运行测试确保功能正常。
EOF
}

# 构建测试修复Prompt - 让AI修复测试失败
build_fix_prompt() {
    local test_output="$1"

    cat << EOF
测试运行失败，请分析错误并修复。

## 测试输出
$test_output

## 修复要求

1. 分析测试失败的原因
2. 定位问题代码
3. 修复代码或测试
4. 确保修复后测试通过

## 注意事项
- 不要删除或跳过测试
- 修复代码而不是修改测试期望值（除非测试本身有误）
- 确保修复不会引入新的问题

开始修复...
EOF
}

# 运行Claude分析任务（带超时）
run_claude_analyze() {
    local iteration="$1"
    local prompt=$(build_analyze_prompt)
    local output_file=$(mktemp)
    local pid_file=$(mktemp)

    log_ai "AI 正在分析项目状态... (超时: $((ANALYZE_TIMEOUT/60))分钟)"
    local start_time=$(date '+%Y-%m-%d %H:%M:%S')
    log_info "开始时间: $start_time"

    # 后台运行 Claude
    (
        echo "$prompt" | claude -p > "$output_file" 2>&1
        echo $? > "$pid_file.exit"
    ) &
    local claude_pid=$!
    echo $claude_pid > "$pid_file"

    # 等待执行完成或超时
    local elapsed=0
    local check_interval=10
    local last_size=0
    local no_progress_count=0
    local max_no_progress=180  # 30分钟无输出视为卡死 (180 * 10秒)

    while kill -0 $claude_pid 2>/dev/null; do
        sleep $check_interval
        elapsed=$((elapsed + check_interval))

        # 检查输出文件是否有更新（心跳检测）
        if [ -f "$output_file" ]; then
            local current_size=$(wc -c < "$output_file" 2>/dev/null || echo "0")
            if [ "$current_size" -eq "$last_size" ]; then
                no_progress_count=$((no_progress_count + 1))
                if [ $no_progress_count -ge $max_no_progress ]; then
                    log_error "进程无响应超过30分钟，可能已卡死，强制终止..."
                    pkill -TERM -P $claude_pid 2>/dev/null || true
                    sleep 2
                    pkill -KILL -P $claude_pid 2>/dev/null || true
                    kill -9 $claude_pid 2>/dev/null || true
                    rm -f "$output_file" "$pid_file" "$pid_file.exit"
                    return 2
                fi
            else
                last_size=$current_size
                no_progress_count=0
            fi
        fi

        # 显示进度（每分钟）
        if [ $((elapsed % 60)) -eq 0 ]; then
            log_info "分析中... 已运行 $((elapsed / 60)) 分钟"
        fi

        # 检查超时
        if [ $elapsed -ge $ANALYZE_TIMEOUT ]; then
            log_error "分析超时 ($((ANALYZE_TIMEOUT/60))分钟)，强制终止..."
            pkill -TERM -P $claude_pid 2>/dev/null || true
            sleep 2
            pkill -KILL -P $claude_pid 2>/dev/null || true
            kill -9 $claude_pid 2>/dev/null || true
            rm -f "$output_file" "$pid_file" "$pid_file.exit"
            return 2
        fi
    done

    # 检查退出状态
    local exit_code=1
    if [ -f "$pid_file.exit" ]; then
        exit_code=$(cat "$pid_file.exit")
    fi

    local end_time=$(date '+%Y-%m-%d %H:%M:%S')
    log_info "结束时间: $end_time (耗时: $((elapsed))秒)"

    if [ $exit_code -eq 0 ]; then
        # 提取任务块
        local task_block=$(sed -n '/```task/,/```/p' "$output_file" | sed '1d;$d')

        if [ -n "$task_block" ]; then
            echo "$task_block" > "$TASK_FILE"
            log_success "AI 生成了新任务"
            cat "$TASK_FILE"
            rm -f "$output_file" "$pid_file" "$pid_file.exit"
            return 0
        else
            log_warning "AI 未能生成有效任务格式"
            cat "$output_file"
            rm -f "$output_file" "$pid_file" "$pid_file.exit"
            return 1
        fi
    else
        log_error "AI 分析失败 (退出码: $exit_code)"
        cat "$output_file"
        rm -f "$output_file" "$pid_file" "$pid_file.exit"
        return 1
    fi
}

# 运行Claude执行任务（带超时）
run_claude_execute() {
    local iteration="$1"
    local task_content=$(cat "$TASK_FILE")
    local prompt=$(build_execute_prompt "$task_content")
    local output_file=$(mktemp)
    local pid_file=$(mktemp)

    log_ai "AI 正在执行任务... (超时: $((EXECUTE_TIMEOUT/60))分钟)"
    local start_time=$(date '+%Y-%m-%d %H:%M:%S')
    log_info "开始时间: $start_time"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # 后台运行 Claude
    (
        echo "$prompt" | claude -p > "$output_file" 2>&1
        echo $? > "$pid_file.exit"
    ) &
    local claude_pid=$!
    echo $claude_pid > "$pid_file"

    # 等待执行完成或超时
    local elapsed=0
    local check_interval=10
    local last_size=0
    local no_progress_count=0
    local max_no_progress=180  # 30分钟无输出视为卡死 (180 * 10秒)

    while kill -0 $claude_pid 2>/dev/null; do
        sleep $check_interval
        elapsed=$((elapsed + check_interval))

        # 检查输出文件是否有更新（心跳检测）
        if [ -f "$output_file" ]; then
            local current_size=$(wc -c < "$output_file" 2>/dev/null || echo "0")
            if [ "$current_size" -eq "$last_size" ]; then
                no_progress_count=$((no_progress_count + 1))
                if [ $no_progress_count -ge $max_no_progress ]; then
                    log_error "进程无响应超过30分钟，可能已卡死，强制终止..."
                    pkill -TERM -P $claude_pid 2>/dev/null || true
                    sleep 2
                    pkill -KILL -P $claude_pid 2>/dev/null || true
                    kill -9 $claude_pid 2>/dev/null || true
                    rm -f "$output_file" "$pid_file" "$pid_file.exit"
                    return 2
                fi
            else
                last_size=$current_size
                no_progress_count=0
            fi
        fi

        # 显示进度（每分钟）
        if [ $((elapsed % 60)) -eq 0 ]; then
            log_info "执行中... 已运行 $((elapsed / 60)) 分钟"
        fi

        # 检查超时
        if [ $elapsed -ge $EXECUTE_TIMEOUT ]; then
            log_error "执行超时 ($((EXECUTE_TIMEOUT/60))分钟)，强制终止..."
            pkill -TERM -P $claude_pid 2>/dev/null || true
            sleep 2
            pkill -KILL -P $claude_pid 2>/dev/null || true
            kill -9 $claude_pid 2>/dev/null || true
            rm -f "$output_file" "$pid_file" "$pid_file.exit"
            return 2
        fi
    done

    # 检查退出状态
    local exit_code=1
    if [ -f "$pid_file.exit" ]; then
        exit_code=$(cat "$pid_file.exit")
    fi

    local end_time=$(date '+%Y-%m-%d %H:%M:%S')
    log_info "结束时间: $end_time (耗时: $((elapsed))秒)"

    # 显示输出
    if [ -f "$output_file" ]; then
        cat "$output_file"
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    rm -f "$output_file" "$pid_file" "$pid_file.exit"

    if [ $exit_code -eq 0 ]; then
        log_success "AI 执行完成"
        return 0
    else
        log_error "AI 执行失败 (退出码: $exit_code)"
        return 1
    fi
}

# 运行测试
run_tests() {
    log_info "运行测试..."

    if [ ! -f "package.json" ]; then
        log_warning "package.json 不存在，跳过测试"
        return 0
    fi

    if ! grep -q '"test"' package.json; then
        log_warning "测试脚本未配置，跳过测试"
        return 0
    fi

    if pnpm test > "$TEST_LOG" 2>&1; then
        log_success "测试通过"
        return 0
    else
        log_error "测试失败"
        tail -50 "$TEST_LOG"
        return 1
    fi
}

# 运行Claude修复测试
run_claude_fix() {
    local test_output=$(tail -100 "$TEST_LOG")
    local prompt=$(build_fix_prompt "$test_output")
    local output_file=$(mktemp)

    log_ai "AI 正在修复测试失败..."

    echo "$prompt" | claude -p > "$output_file" 2>&1
    local exit_code=$?

    cat "$output_file"
    rm -f "$output_file"

    return $exit_code
}

# Git 自动提交
run_git_commit() {
    local iteration="$1"
    local task_name="$2"
    local status="$3"

    # 检查是否是 git 仓库
    if [ ! -d ".git" ]; then
        log_warning "不是 Git 仓库，跳过提交"
        return 0
    fi

    # 检查是否有变更
    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        log_info "检测到文件变更，准备提交..."

        # 获取当前日期作为分支名
        local branch_date=$(date '+%Y%m%d')
        local branch_name="feat/autorun-dev-${branch_date}"

        # 检查并切换到开发分支
        local current_branch=$(git branch --show-current 2>/dev/null || echo "main")
        if [ "$current_branch" != "$branch_name" ]; then
            if git show-ref --verify --quiet "refs/heads/$branch_name"; then
                log_info "切换到已存在的分支: $branch_name"
                git checkout "$branch_name" 2>&1 | grep -v "^M\|^D\|^A" || true
            else
                log_info "创建新分支: $branch_name"
                git checkout -b "$branch_name" 2>&1 | grep -v "^M\|^D\|^A" || true
            fi
        fi

        # 添加所有变更（排除 .env 等敏感文件已在 .gitignore）
        git add -A

        # 生成 commit message
        local commit_msg="feat: ${task_name}

Generated-By: autorun.sh (AI-driven development)
Task-File: CURRENT_TASK.md
Round: ${iteration}
Status: ${status}"

        # 提交
        if git commit -m "$commit_msg" > /dev/null 2>&1; then
            local commit_sha=$(git rev-parse --short HEAD)
            log_success "Git 提交成功: ${commit_sha}"
            log_info "分支: ${branch_name}"

            # 只在任务成功时推送到远程（如果配置了 remote）
            if [ "$status" = "✅ 完成" ] && git remote | grep -q "origin"; then
                log_info "任务成功，推送到远程仓库..."
                if git push -u origin "$branch_name" 2>&1 | tail -5; then
                    log_success "推送到远程成功: origin/$branch_name"
                else
                    log_warning "推送失败（可能需要配置认证）"
                fi
            elif [ "$status" != "✅ 完成" ]; then
                log_info "任务未完全成功，跳过推送到远程"
            fi

            return 0
        else
            log_error "Git 提交失败"
            return 1
        fi
    else
        log_info "没有文件变更，跳过 Git 提交"
        return 0
    fi
}

# 显示进度
show_progress() {
    local iteration="$1"
    local status="$2"
    local current_time=$(date '+%Y-%m-%d %H:%M:%S')

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}ServerPilot AI 自循环开发${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  当前时间: ${BLUE}$current_time${NC}"
    echo -e "  当前轮次: ${PURPLE}$iteration${NC}"
    echo -e "  状态: $status"
    echo -e "  超时设置: 分析 $((ANALYZE_TIMEOUT/60))分钟 / 执行 $((EXECUTE_TIMEOUT/60))分钟"
    echo -e "  日志文件: $LOG_FILE"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# 主函数
main() {
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       ServerPilot AI 自循环开发系统                          ║${NC}"
    echo -e "${CYAN}║       AI 自动分析 -> 生成任务 -> 实现 -> 测试 -> 循环        ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 检查是否支持 caffeinate（防止睡眠）
    if command -v caffeinate &> /dev/null; then
        log_info "启用防睡眠模式 (caffeinate)"
        # 在后台运行 caffeinate，阻止系统睡眠
        caffeinate -disu -w $$ &
        CAFFEINATE_PID=$!
        trap "kill $CAFFEINATE_PID 2>/dev/null" EXIT
    else
        log_warning "caffeinate 不可用，系统可能会睡眠导致脚本中断"
    fi

    # 添加日志分隔符（追加模式，不清空历史）
    echo "" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════" >> "$LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 新的自动开发会话开始" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"

    # 检查环境
    check_environment

    echo ""
    log_info "启动 AI 自循环开发..."
    log_info "产品方案目录: $PRODUCT_GUIDE"
    log_info "开发标准: $DEV_STANDARD"
    log_info "循环间隔: ${INTERVAL}秒"
    log_info "按 Ctrl+C 可随时停止"
    echo ""

    local iteration=0

    # 主循环
    while [ $iteration -lt $MAX_ITERATIONS ]; do
        iteration=$((iteration + 1))

        show_progress $iteration "${BLUE}分析中...${NC}"

        # 步骤1: AI 分析项目并生成任务（带重试）
        log_task "第 $iteration 轮: 分析项目状态..."

        local analyze_retry=0
        local analyze_success=false

        while [ $analyze_retry -lt $MAX_RETRIES ]; do
            analyze_retry=$((analyze_retry + 1))

            if [ $analyze_retry -gt 1 ]; then
                log_warning "分析阶段第 $analyze_retry 次尝试..."
            fi

            if run_claude_analyze $iteration; then
                local task_name=$(grep "任务名称:" "$TASK_FILE" | cut -d':' -f2- | xargs)

                if [ -n "$task_name" ]; then
                    analyze_success=true
                    break
                else
                    log_warning "未提取到有效任务名称"
                fi
            else
                local analyze_exit=$?
                if [ $analyze_exit -eq 2 ]; then
                    log_error "分析阶段超时"
                else
                    log_error "分析阶段失败"
                fi
            fi

            if [ $analyze_retry -lt $MAX_RETRIES ]; then
                log_warning "等待30秒后重试分析..."
                sleep 30
            fi
        done

        # 分析失败，记录并跳过本轮
        if [ "$analyze_success" != true ]; then
            log_error "分析阶段失败 (已尝试 $MAX_RETRIES 次)，跳过本轮"
            record_state $iteration "分析失败" "⏭️ 跳过 (分析阶段失败 $MAX_RETRIES 次)"
            show_progress $iteration "${RED}跳过: 分析阶段失败${NC}"
            log_info "等待 ${INTERVAL}秒 后继续下一轮..."
            sleep $INTERVAL
            continue
        fi

        log_task "第 $iteration 轮: $task_name"
        show_progress $iteration "${YELLOW}执行中: $task_name${NC}"

        # 步骤2: AI 执行任务（带重试）
        local execute_retry=0
        local task_success=false

        while [ $execute_retry -lt $MAX_RETRIES ]; do
            execute_retry=$((execute_retry + 1))

            if [ $execute_retry -gt 1 ]; then
                log_warning "执行阶段第 $execute_retry 次尝试..."
            fi

            if run_claude_execute $iteration; then
                # 步骤3: 运行测试
                if run_tests; then
                    task_success=true
                    break
                else
                    # 测试失败，让AI修复
                    log_warning "测试失败，尝试让 AI 修复..."
                    run_claude_fix

                    # 再次运行测试
                    if run_tests; then
                        task_success=true
                        break
                    fi
                fi
            else
                local execute_exit=$?
                if [ $execute_exit -eq 2 ]; then
                    log_error "执行阶段超时"
                else
                    log_error "执行阶段失败"
                fi
            fi

            if [ $execute_retry -lt $MAX_RETRIES ]; then
                log_warning "等待30秒后重试执行..."
                sleep 30
            fi
        done

        # 记录状态
        if [ "$task_success" = true ]; then
            record_state $iteration "$task_name" "✅ 完成"
            show_progress $iteration "${GREEN}完成: $task_name${NC}"

            # Git 自动提交（仅在任务成功时）
            log_info "步骤 4: Git 提交变更..."
            run_git_commit $iteration "$task_name" "✅ 完成"
        else
            record_state $iteration "$task_name" "❌ 失败 (执行阶段尝试 $MAX_RETRIES 次)"
            show_progress $iteration "${RED}失败: $task_name${NC}"
        fi

        # 等待间隔
        log_info "等待 ${INTERVAL}秒 后继续下一轮..."
        sleep $INTERVAL
    done

    if [ $iteration -ge $MAX_ITERATIONS ]; then
        log_warning "达到最大迭代次数 ($MAX_ITERATIONS)，停止执行"
    fi

    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       AI 自循环开发结束                                      ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    log_info "日志文件: $LOG_FILE"
    log_info "状态文件: $STATE_FILE"
}

# 信号处理
trap 'echo ""; log_warning "收到中断信号，正在退出..."; exit 130' INT TERM

# 运行
main "$@"
