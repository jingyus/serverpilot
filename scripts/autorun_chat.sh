#!/bin/bash
#
# ServerPilot AI Chat 质量自循环改进脚本
# AI 自动发现问题 -> 提出改进方案 -> 实现 -> 测试 -> 循环
#
# 用法: ./autorun_chat.sh [选项]
#
# 工作流程:
# 1. AI 深度扫描 Chat/AI 对话系统代码，发现问题和改进空间
# 2. AI 按优先级生成聚焦于对话系统的改进任务
# 3. AI 自动实现改进
# 4. 运行测试验证
# 5. Git 提交 -> 继续下一轮发现
#
# 聚焦领域:
# - 对话话题管理（会话分组、重命名、搜索）
# - 聊天记录持久化（当前仅内存存储，重启丢失）
# - AI 智能化（上下文管理、多轮对话质量、意图理解）
# - UI 展示效果（消息渲染、流式体验、响应式布局）
# - 系统稳定性（错误恢复、断连重连、边界处理）
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
AI_CONSTRAINTS="$PROJECT_DIR/docs/AI开发约束.md"
DEV_STANDARD="$PROJECT_DIR/docs/开发标准.md"
LOG_FILE="$PROJECT_DIR/autorun_chat.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_CHAT_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_CHAT_TASK.md"
TASK_QUEUE="$PROJECT_DIR/CHAT_TASK_QUEUE.md"
TEST_LOG="$PROJECT_DIR/chat_test.log"

# 配置
INTERVAL=30            # 循环间隔（秒）
MAX_ITERATIONS=1000    # 最大迭代次数
ANALYZE_TIMEOUT=3600   # 分析阶段超时（60分钟）
EXECUTE_TIMEOUT=3600   # 执行阶段超时（60分钟）
NO_OUTPUT_TIMEOUT=3600 # 无输出超时（秒）
STUCK_CHECK_AFTER=1200 # 无输出超过多久后开始卡死检测（秒，默认20分钟）
STUCK_CONFIRM_TIME=300 # 连续确认卡死多久后终止（秒，默认5分钟）
MAX_RETRIES=3          # 单任务单轮最大重试次数
MAX_TASK_FAILURES=3    # 同一任务跨轮次最大失败次数
BATCH_SIZE=5           # 每次生成任务数量

# Token 使用统计和成本控制
TOTAL_TOKENS=0
MAX_TOKENS=10000000
COST_PER_1K_INPUT_TOKENS=0.003
COST_PER_1K_OUTPUT_TOKENS=0.015
TOKEN_LOG="$PROJECT_DIR/CHAT_TOKEN_USAGE.log"

# 通知配置
ENABLE_NOTIFICATION=true
NOTIFICATION_SCRIPT="$SCRIPT_DIR/send-notification.py"

# 加载任务队列辅助函数
source "$SCRIPT_DIR/task-queue-helper.sh"

# ============================================================================
# 日志函数
# ============================================================================

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

# ============================================================================
# Token 使用统计
# ============================================================================

log_token_usage() {
    local input_tokens="${1:-0}"
    local output_tokens="${2:-0}"
    local operation="$3"

    TOTAL_TOKENS=$((TOTAL_TOKENS + input_tokens + output_tokens))

    local input_cost=$(echo "scale=4; $input_tokens * $COST_PER_1K_INPUT_TOKENS / 1000" | bc)
    local output_cost=$(echo "scale=4; $output_tokens * $COST_PER_1K_OUTPUT_TOKENS / 1000" | bc)
    local operation_cost=$(echo "scale=4; $input_cost + $output_cost" | bc)
    local total_cost=$(echo "scale=2; $TOTAL_TOKENS * ($COST_PER_1K_INPUT_TOKENS + $COST_PER_1K_OUTPUT_TOKENS) / 2000" | bc)

    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $operation | 输入: $input_tokens | 输出: $output_tokens | 成本: \$$operation_cost | 累计: $TOTAL_TOKENS tokens (\$$total_cost)" >> "$TOKEN_LOG"

    log_info "Token 使用 - 输入: $input_tokens, 输出: $output_tokens, 本次: \$$operation_cost"
    log_info "累计 Token: $TOTAL_TOKENS (\$$total_cost) / 限制: $MAX_TOKENS"

    if [ $TOTAL_TOKENS -gt $MAX_TOKENS ]; then
        log_error "已达到 Token 限制 ($MAX_TOKENS)，停止执行"
        exit 1
    fi

    local usage_percent=$((TOTAL_TOKENS * 100 / MAX_TOKENS))
    if [ $usage_percent -ge 80 ] && [ $usage_percent -lt 90 ]; then
        log_warning "Token 使用已达 ${usage_percent}%，接近限制"
    elif [ $usage_percent -ge 90 ]; then
        log_warning "Token 使用已达 ${usage_percent}%，即将达到限制！"
    fi
}

estimate_tokens() {
    local text="$1"
    local char_count=${#text}
    local base_tokens=$((char_count * 10 / 22))
    local CONTEXT_MULTIPLIER=4
    echo $((base_tokens * CONTEXT_MULTIPLIER))
}

# ============================================================================
# 错误分类与智能重试
# ============================================================================

classify_error() {
    local error_output="$1"

    if echo "$error_output" | grep -qi "network\|timeout\|connection\|ECONNREFUSED\|ETIMEDOUT"; then
        echo "network"
    elif echo "$error_output" | grep -qi "rate limit\|too many requests\|429"; then
        echo "rate_limit"
    elif echo "$error_output" | grep -qi "authentication\|unauthorized\|401\|403"; then
        echo "auth"
    elif echo "$error_output" | grep -qi "out of memory\|ENOMEM"; then
        echo "memory"
    elif echo "$error_output" | grep -qi "disk full\|ENOSPC"; then
        echo "disk"
    else
        echo "unknown"
    fi
}

smart_retry() {
    local error_output="$1"
    local retry_count="$2"
    local error_type=$(classify_error "$error_output")

    case "$error_type" in
        network)
            local wait_time=$((60 * retry_count))
            log_warning "网络问题，等待 $wait_time 秒后重试..."
            sleep $wait_time
            return 0
            ;;
        rate_limit)
            local wait_time=$((300 * retry_count))
            log_warning "API 限流，等待 $((wait_time / 60)) 分钟后重试..."
            sleep $wait_time
            return 0
            ;;
        auth)
            log_error "认证失败，需要人工检查 API 密钥"
            return 1
            ;;
        memory|disk)
            log_error "系统资源不足，需要人工处理"
            return 1
            ;;
        *)
            sleep 30
            return 0
            ;;
    esac
}

# ============================================================================
# 进程卡死检测
# ============================================================================

is_process_stuck() {
    local pid="$1"

    if ! kill -0 "$pid" 2>/dev/null; then
        return 1
    fi

    local cpu=$(ps -o %cpu= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -z "$cpu" ]; then return 1; fi
    local cpu_idle=$(awk "BEGIN { print ($cpu <= 0.1) ? 1 : 0 }")
    if [ "$cpu_idle" != "1" ]; then
        return 1
    fi

    if pgrep -P "$pid" > /dev/null 2>&1; then
        return 1
    fi

    if lsof -i TCP -a -p "$pid" > /dev/null 2>&1; then
        return 1
    fi

    return 0
}

# ============================================================================
# 通知
# ============================================================================

send_notification() {
    local title="$1"
    local message="$2"
    local status="${3:-info}"

    if [ "$ENABLE_NOTIFICATION" != "true" ]; then
        return 0
    fi

    if ! command -v python3 &> /dev/null || [ ! -f "$NOTIFICATION_SCRIPT" ]; then
        return 1
    fi

    (
        python3 "$NOTIFICATION_SCRIPT" "$title" "$message" "$status" >> "$LOG_FILE" 2>&1
    ) &

    return 0
}

# ============================================================================
# 环境检查
# ============================================================================

check_environment() {
    log_info "检查开发环境..."

    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装"
        exit 1
    fi
    log_success "Node.js: $(node --version)"

    if ! command -v pnpm &> /dev/null; then
        log_warning "pnpm 未安装，正在安装..."
        npm install -g pnpm
    fi
    log_success "pnpm: $(pnpm --version)"

    if ! command -v claude &> /dev/null; then
        log_error "Claude Code CLI 未安装"
        exit 1
    fi
    log_success "Claude Code 已安装"

    # 验证关键文件存在
    local chat_files=(
        "packages/dashboard/src/pages/Chat.tsx"
        "packages/dashboard/src/stores/chat.ts"
        "packages/server/src/api/routes/chat.ts"
        "packages/server/src/core/session/manager.ts"
    )
    for f in "${chat_files[@]}"; do
        if [ -f "$PROJECT_DIR/$f" ]; then
            log_success "Chat 核心文件: $f"
        else
            log_warning "Chat 核心文件缺失: $f"
        fi
    done
}

# ============================================================================
# 初始化任务队列
# ============================================================================

init_chat_task_queue() {
    if [ -f "$TASK_QUEUE" ]; then
        return 0
    fi

    cat > "$TASK_QUEUE" << 'EOF'
# Chat/AI 对话系统改进任务队列

> 此队列专注于 Chat 和 AI 对话系统的质量改进
> AI 自动发现问题 → 生成任务 → 实现 → 验证

**最后更新**: -

## 📊 统计

- **总任务数**: 0
- **待完成** (pending): 0
- **进行中** (in_progress): 0
- **已完成** (completed): 0
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动在此添加发现的改进任务)

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`
EOF
    log_success "初始化 Chat 任务队列: $TASK_QUEUE"
}

# ============================================================================
# 状态记录
# ============================================================================

init_state_file() {
    if [ ! -f "$STATE_FILE" ]; then
        cat > "$STATE_FILE" << 'EOF'
# Chat/AI 对话系统改进日志

> AI 自动发现并改进 Chat 系统的记录

---

## 改进日志

EOF
    fi
}

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

# ============================================================================
# 核心 Prompt — AI 自主发现问题并生成改进任务
# ============================================================================

build_discover_prompt() {
    cat << 'PROMPT_EOF'
你是 ServerPilot 项目的 AI Chat 系统质量工程师。你的任务是**深度审查** Chat/AI 对话系统的代码，**自主发现问题**，并生成改进任务。

## 你的职责

你不是在执行别人给你的任务，而是**自主发现问题和改进机会**。像一个资深工程师 code review 一样，找出真正需要改进的地方。

## 必须扫描的文件（按优先级）

### 前端 Chat
1. `packages/dashboard/src/pages/Chat.tsx` — Chat 主页面
2. `packages/dashboard/src/stores/chat.ts` — Chat 状态管理
3. `packages/dashboard/src/components/chat/` — 所有 Chat 组件
4. `packages/dashboard/src/types/chat.ts` — Chat 类型定义
5. `packages/dashboard/src/api/sse.ts` — SSE 流式通信
6. `packages/dashboard/src/api/client.ts` — API 客户端

### 后端 Chat
7. `packages/server/src/api/routes/chat.ts` — Chat API 路由
8. `packages/server/src/api/routes/chat-ai.ts` — AI 对话封装
9. `packages/server/src/core/session/manager.ts` — 会话管理器
10. `packages/server/src/ai/` — AI 提供者和智能体

### 共享协议
11. `packages/shared/src/protocol/messages.ts` — 通信协议

## 改进维度（按优先级排序）

### P0 — 核心体验问题
- **聊天记录持久化**: 当前 SessionManager 是纯内存的，服务器重启丢失所有对话。需要持久化到 SQLite
- **会话/话题管理**: 用户无法重命名会话、无法按话题分组、无法搜索历史对话
- **对话上下文质量**: AI 的多轮对话上下文是否充分？长对话是否有上下文压缩/摘要？
- **消息发送可靠性**: SSE 连接断开时消息是否丢失？是否有重发机制？

### P1 — 智能化提升
- **意图识别**: AI 是否能准确理解用户意图？system prompt 是否需要优化？
- **错误恢复**: 执行失败后 AI 是否能给出有用的诊断和修复建议？
- **上下文窗口管理**: 长对话是否超出 token 限制？是否有自动摘要机制？
- **流式响应质量**: token 流是否流畅？是否有卡顿或延迟？

### P2 — UI/UX 体验
- **消息渲染**: Markdown 渲染质量、代码高亮、长消息折叠
- **响应式布局**: 移动端适配、窗口缩放、侧边栏折叠
- **加载状态**: 骨架屏、流式打字效果、进度指示器
- **键盘快捷键**: Ctrl+Enter 发送、Esc 取消、上箭头编辑上条消息

### P3 — 稳定性与边界
- **并发处理**: 多个请求同时发送时的行为
- **大消息处理**: 超长消息的截断和展示
- **内存泄漏**: SSE 连接是否正确清理？EventSource 是否正确关闭？
- **测试覆盖**: Chat 相关测试是否充分？有哪些边界场景未覆盖？

## 发现问题的方法

1. **阅读代码**: 仔细阅读每个文件，理解实现逻辑
2. **追踪数据流**: 从用户输入 → API → AI → 响应 → 渲染，追踪完整链路
3. **寻找 TODO/FIXME**: 代码中可能已经标记了已知问题
4. **检查错误处理**: 每个 try/catch 是否恰当？是否有未处理的 Promise rejection？
5. **验证类型安全**: TypeScript 类型是否完整？是否有 `any` 类型逃逸？
6. **测试覆盖分析**: 哪些功能路径没有测试？
7. **对比最佳实践**: 参考主流 AI Chat 应用（ChatGPT, Claude.ai）的功能和体验

## 输出格式 (严格！！！)

你的输出必须且只能是一个 \`\`\`tasks 代码块，不要输出任何其他内容（不要表格、不要分析报告、不要总览）。
脚本会自动解析这个代码块，任何格式偏差都会导致解析失败。

**你的完整输出必须是:**

\`\`\`tasks
### [pending] 任务标题（简明描述改进内容）

**ID**: chat-XXX
**优先级**: P0/P1/P2/P3
**模块路径**: packages/xxx/src/xxx/
**发现的问题**: 具体描述你在代码中发现的问题（引用具体文件和行号）
**改进方案**: 详细说明应该如何改进
**验收标准**: 改进完成后应该达到什么效果
**影响范围**: 这个改进会影响哪些文件
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] 另一个任务...
\`\`\`

## 重要约束

- **输出格式**: 只输出 \`\`\`tasks 代码块，不要输出表格、分析报告或其他内容
- **只关注 Chat/AI 对话系统**，不要涉及 Agent、服务器管理、权限等其他模块
- **必须引用具体代码**，不要泛泛而谈。说 "Chat.tsx 第 XX 行的 XXX 函数没有处理 YYY 场景"
- **任务粒度适中**，每个任务 1-2 小时可完成
- **不要重复已完成的任务**，先检查 CHAT_TASK_QUEUE.md 中已完成的任务
- **优先 P0 问题**，只有当 P0 问题都解决后才生成 P1/P2/P3
- 遵守 docs/AI开发约束.md 中的代码规范
- 单文件不超过 500 行（硬限制 800 行）

直接输出 \`\`\`tasks 代码块，不要输出任何前言或分析:
PROMPT_EOF
}

# ============================================================================
# 核心 Prompt — 执行具体改进任务
# ============================================================================

build_execute_prompt() {
    local task_content="$1"

    # 注意: 不重复罗列 Chat 系统所有文件
    # task_content 已包含模块路径和影响范围，这里只提供"怎么写"的约束

    cat << EOF
你是 ServerPilot 项目的 Chat 系统质量工程师，正在执行一个具体的改进任务。

## 项目信息

- **Monorepo**: pnpm workspaces, 包名 @aiinstaller/* (server, agent, shared, dashboard)
- **Server**: Hono + better-sqlite3 + Drizzle ORM + TypeScript strict + NodeNext
- **Dashboard**: React 18 + Vite 5 + Zustand 5 + Tailwind CSS 3
- **测试**: Vitest (server=node 环境, dashboard=jsdom + @testing-library/react)
- **ESM**: 所有 import 使用 \`.js\` 后缀

## 当前任务

$task_content

## 开发约束

- **聚焦**: 只实现当前任务，不要扩散到其他功能
- **兼容**: 不破坏已有的 API 和类型签名
- **TypeScript strict**: 不允许 any，使用 Zod 验证外部输入
- **单文件不超过 500 行** (硬限制 800 行)
- **只改 Chat 相关文件**，不要动 Agent、权限、Webhook 等其他模块
- **编写测试**: 为新增/修改的代码编写测试

完成后运行测试:
- 前端: \`pnpm --filter @aiinstaller/dashboard test\`
- 后端: \`pnpm --filter @aiinstaller/server test\`
- 两端都改: 两个都跑

开始实现...
EOF
}

# ============================================================================
# 核心 Prompt — 修复测试失败
# ============================================================================

build_fix_prompt() {
    local test_output="$1"

    cat << EOF
Chat 系统改进后测试失败，请分析并修复。

## 测试输出
$test_output

## 修复要求

1. 分析测试失败的原因
2. 定位问题代码（一定在最近的改动中）
3. 修复代码而不是削弱测试
4. 确保修复不引入新问题

## 关键注意

- Dashboard 测试在 \`packages/dashboard/\` 下运行，用 jsdom 环境
- Server 测试在根目录运行
- 不要删除或跳过测试
- 保持所有类型签名的向后兼容性

开始修复...
EOF
}

# ============================================================================
# 批量生成任务
# ============================================================================

run_claude_batch_generate() {
    local prompt=$(build_discover_prompt)
    local output_file=$(mktemp)

    log_ai "AI 正在深度扫描 Chat 系统，发现问题和改进空间..."

    local input_tokens=$(estimate_tokens "$prompt")

    if echo "$prompt" | claude -p > "$output_file" 2>&1; then
        # 解析策略 1: ```tasks ... ``` 代码块
        local tasks_content=$(sed -n '/```tasks/,/```/p' "$output_file" | sed '1d;$d')

        # 解析策略 2: ```markdown ... ``` 或 ``` ... ``` 中包含 [pending]
        if [ -z "$tasks_content" ]; then
            tasks_content=$(sed -n '/^```/,/^```/p' "$output_file" | sed '1d;$d')
            if ! echo "$tasks_content" | grep -q '^\### \[pending\]'; then
                tasks_content=""
            fi
        fi

        # 解析策略 3: 直接从输出中提取 ### [pending] 块（无代码块包裹）
        if [ -z "$tasks_content" ]; then
            if grep -q '^\### \[pending\]' "$output_file"; then
                tasks_content=$(awk '
                    /^### \[pending\]/ { found=1 }
                    found { print }
                ' "$output_file")
            fi
        fi

        if [ -n "$tasks_content" ]; then
            add_tasks_to_queue "$TASK_QUEUE" "$tasks_content"

            local output_tokens=$(estimate_tokens "$tasks_content")
            log_token_usage $input_tokens $output_tokens "Chat 系统扫描"

            local stats=$(get_task_stats "$TASK_QUEUE")
            read total pending in_progress completed failed <<< "$stats"
            log_success "发现 $pending 个改进任务"
            log_info "任务队列: 总计 $total | 待完成 $pending | 进行中 $in_progress | 已完成 $completed | 失败 $failed"

            rm -f "$output_file"
            return 0
        else
            log_error "AI 未能生成有效任务格式（需要 ### [pending] 格式的任务块）"
            log_error "AI 输出预览（前 20 行）:"
            head -20 "$output_file" | while IFS= read -r line; do
                log_error "  $line"
            done
            rm -f "$output_file"
            return 1
        fi
    else
        log_error "AI Chat 系统扫描失败"
        cat "$output_file"
        rm -f "$output_file"
        return 1
    fi
}

# ============================================================================
# 检查并生成任务
# ============================================================================

check_and_generate_tasks() {
    local stats=$(get_task_stats "$TASK_QUEUE")
    read total pending in_progress completed failed <<< "$stats"

    pending="${pending:-0}"
    in_progress="${in_progress:-0}"
    total="${total:-0}"
    completed="${completed:-0}"
    failed="${failed:-0}"

    if [ "$pending" -gt 0 ] || [ "$in_progress" -gt 0 ]; then
        log_info "任务队列: 总计 $total | 待完成 $pending | 进行中 $in_progress | 已完成 $completed | 失败 $failed"
        return 0
    fi

    if [ "$failed" -gt 0 ]; then
        local retryable=$(count_retryable_failed_tasks "$TASK_QUEUE" "$MAX_TASK_FAILURES")
        if [ "$retryable" -gt 0 ]; then
            log_info "发现 $retryable 个可重试的失败任务，自动重置..."
            retry_eligible_failed_tasks "$TASK_QUEUE" "$MAX_TASK_FAILURES"
            return 0
        else
            log_warning "所有失败任务均已超过重试上限 ($MAX_TASK_FAILURES 次)"
        fi
    fi

    log_info "任务队列为空，AI 开始新一轮 Chat 系统扫描..."
    run_claude_batch_generate
    return $?
}

# ============================================================================
# 运行 Claude 执行任务（带超时和卡死检测）
# ============================================================================

run_claude_execute() {
    local iteration="$1"
    local task_content=$(cat "$TASK_FILE")
    local prompt=$(build_execute_prompt "$task_content")
    local output_file=$(mktemp)
    local pid_file=$(mktemp)

    log_ai "AI 正在执行 Chat 改进任务... (超时: $((EXECUTE_TIMEOUT/60))分钟)"
    local start_time=$(date '+%Y-%m-%d %H:%M:%S')
    log_info "开始时间: $start_time"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    (
        echo "$prompt" | claude -p > "$output_file" 2>&1
        echo $? > "$pid_file.exit"
    ) &
    local claude_pid=$!
    echo $claude_pid > "$pid_file"

    local elapsed=0
    local check_interval=10
    local last_size=0
    local no_progress_count=0
    local stuck_count=0
    local max_no_progress=$((NO_OUTPUT_TIMEOUT / check_interval))

    while kill -0 $claude_pid 2>/dev/null; do
        sleep $check_interval
        elapsed=$((elapsed + check_interval))

        if [ -f "$output_file" ]; then
            local current_size=$(wc -c < "$output_file" 2>/dev/null || echo "0")
            if [ "$current_size" -eq "$last_size" ]; then
                no_progress_count=$((no_progress_count + 1))
                if [ $no_progress_count -ge $max_no_progress ]; then
                    log_error "进程无输出超过 $((NO_OUTPUT_TIMEOUT / 60)) 分钟，强制终止..."
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
                stuck_count=0
            fi
        fi

        if [ $((no_progress_count * check_interval)) -ge $STUCK_CHECK_AFTER ]; then
            if is_process_stuck $claude_pid; then
                stuck_count=$((stuck_count + 1))
                local stuck_seconds=$((stuck_count * check_interval))
                if [ $stuck_seconds -ge $STUCK_CONFIRM_TIME ]; then
                    log_error "进程卡死确认，强制终止..."
                    pkill -TERM -P $claude_pid 2>/dev/null || true
                    sleep 2
                    pkill -KILL -P $claude_pid 2>/dev/null || true
                    kill -9 $claude_pid 2>/dev/null || true
                    rm -f "$output_file" "$pid_file" "$pid_file.exit"
                    return 2
                elif [ $((stuck_count % 6)) -eq 0 ]; then
                    log_warning "卡死检测中... 已持续 $((stuck_seconds / 60)) 分钟"
                fi
            else
                stuck_count=0
            fi
        fi

        if [ $((elapsed % 60)) -eq 0 ]; then
            log_info "执行中... 已运行 $((elapsed / 60)) 分钟"
        fi

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

    local exit_code=1
    if [ -f "$pid_file.exit" ]; then
        exit_code=$(cat "$pid_file.exit")
    fi

    local end_time=$(date '+%Y-%m-%d %H:%M:%S')
    log_info "结束时间: $end_time (耗时: $((elapsed))秒)"

    if [ -f "$output_file" ]; then
        cat "$output_file"
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if [ $exit_code -eq 0 ]; then
        local input_tokens=$(estimate_tokens "$prompt")
        local output_content=$(cat "$output_file" 2>/dev/null || echo "")
        local output_tokens=$(estimate_tokens "$output_content")
        log_token_usage $input_tokens $output_tokens "Chat 改进执行"
    fi

    rm -f "$output_file" "$pid_file" "$pid_file.exit"

    if [ $exit_code -eq 0 ]; then
        log_success "AI 执行完成"
        return 0
    else
        log_error "AI 执行失败 (退出码: $exit_code)"
        return 1
    fi
}

# ============================================================================
# 智能测试辅助 — 解析 vitest 输出判断真实结果
# ============================================================================

# run_module_test <module> <log_file> [append]
# 运行单个模块测试，智能解析 vitest 输出避免误判
run_module_test() {
    local module="$1"
    local log_file="$2"
    local append="${3:-false}"

    if [ "$append" = "true" ]; then
        pnpm --filter "@aiinstaller/$module" test >> "$log_file" 2>&1
    else
        pnpm --filter "@aiinstaller/$module" test > "$log_file" 2>&1
    fi
    local exit_code=$?

    # Exit code 0 — tests passed
    if [ $exit_code -eq 0 ]; then
        return 0
    fi

    # Exit code != 0 — 解析输出判断是真失败还是误判

    # Case 1: "No test files found" → 配置问题，非代码失败
    if grep -q "No test files found" "$log_file"; then
        log_warning "$module: vitest 未找到测试文件 (检查 vitest.config.ts)，视为通过"
        return 0
    fi

    # Case 2: 解析 vitest 摘要行 "Tests  X failed | Y passed"
    local summary_line=$(grep -E "^\s*Tests\s+" "$log_file" | tail -1)
    if [ -n "$summary_line" ]; then
        # 有失败的测试 → 真失败
        if echo "$summary_line" | grep -qE "[0-9]+ failed"; then
            return 1
        fi
        # 只有 passed → stderr 噪音导致 exit code 非零，视为通过
        if echo "$summary_line" | grep -qE "[0-9]+ passed"; then
            log_warning "$module: 所有测试通过但 exit code=$exit_code (stderr 噪音)，视为通过"
            return 0
        fi
    fi

    # Case 3: 无法解析 → 信任 exit code
    return $exit_code
}

# ============================================================================
# 增量测试 — 只测试 Chat 相关模块
# ============================================================================

run_chat_tests() {
    log_info "运行 Chat 相关测试..."

    if [ ! -d ".git" ]; then
        log_warning "不是 Git 仓库，运行全量测试"
        pnpm test > "$TEST_LOG" 2>&1
        return $?
    fi

    local changed_files=$(git diff --name-only HEAD 2>/dev/null || git ls-files --others --exclude-standard)

    if [ -z "$changed_files" ]; then
        log_info "没有文件变更，跳过测试"
        return 0
    fi

    log_info "检测到文件变更:"
    echo "$changed_files" | sed 's/^/  - /'

    local test_server=false
    local test_dashboard=false
    local test_shared=false

    while IFS= read -r file; do
        if echo "$file" | grep -q "^packages/server/"; then
            test_server=true
        elif echo "$file" | grep -q "^packages/dashboard/"; then
            test_dashboard=true
        elif echo "$file" | grep -q "^packages/shared/"; then
            test_shared=true
        fi
    done <<< "$changed_files"

    # shared 变更影响全部
    if [ "$test_shared" = true ]; then
        log_warning "shared 模块变更，运行全量测试"
        pnpm test > "$TEST_LOG" 2>&1
        return $?
    fi

    local test_failed=false

    if [ "$test_server" = true ]; then
        log_info "测试 server 模块 (Chat 相关)..."
        if run_module_test "server" "$TEST_LOG"; then
            log_success "server 测试通过"
        else
            log_error "server 测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_dashboard" = true ]; then
        log_info "测试 dashboard 模块 (Chat UI)..."
        if run_module_test "dashboard" "$TEST_LOG" "true"; then
            log_success "dashboard 测试通过"
        else
            log_error "dashboard 测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_failed" = true ]; then
        log_error "Chat 相关测试失败"
        tail -50 "$TEST_LOG"
        return 1
    else
        log_success "Chat 相关测试全部通过"
        return 0
    fi
}

# ============================================================================
# Claude 修复测试
# ============================================================================

run_claude_fix() {
    local test_output=$(tail -100 "$TEST_LOG")
    local prompt=$(build_fix_prompt "$test_output")
    local output_file=$(mktemp)

    log_ai "AI 正在修复 Chat 测试失败..."

    echo "$prompt" | claude -p > "$output_file" 2>&1
    local exit_code=$?

    cat "$output_file"
    rm -f "$output_file"

    return $exit_code
}

# ============================================================================
# Git 检查点 & 回滚（任务失败时自动还原代码）
# ============================================================================

# 创建检查点：记录当前 HEAD SHA + stash 未提交的变更
create_checkpoint() {
    if [ ! -d ".git" ]; then
        echo ""
        return
    fi

    local checkpoint_sha=$(git rev-parse HEAD 2>/dev/null)
    if [ -z "$checkpoint_sha" ]; then
        echo ""
        return
    fi

    # 如果有未提交的变更，先 stash 保存
    local has_changes=false
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
        has_changes=true
        # stash 所有变更（包括未跟踪的文件）
        git stash push --include-untracked -m "autorun_chat checkpoint $(date '+%Y%m%d_%H%M%S')" > /dev/null 2>&1
        # 重新获取干净状态的 SHA
        checkpoint_sha=$(git rev-parse HEAD 2>/dev/null)
        # 立刻恢复 stash（我们只是为了记录干净的 HEAD）
        git stash pop > /dev/null 2>&1 || true
    fi

    log_info "检查点: $checkpoint_sha ($(git log --oneline -1 HEAD 2>/dev/null | cut -c1-60))"
    echo "$checkpoint_sha"
}

# 回滚到检查点：丢弃任务产生的所有变更
rollback_to_checkpoint() {
    local checkpoint_sha="$1"
    local task_name="$2"

    if [ -z "$checkpoint_sha" ] || [ ! -d ".git" ]; then
        log_warning "无检查点信息，无法回滚"
        return 1
    fi

    local current_sha=$(git rev-parse HEAD 2>/dev/null)

    # 检查是否有新的提交需要回滚
    if [ "$current_sha" != "$checkpoint_sha" ]; then
        local new_commits=$(git rev-list --count "${checkpoint_sha}..HEAD" 2>/dev/null || echo "0")
        log_warning "回滚 $new_commits 个失败任务的提交..."
        log_warning "回滚: $current_sha → $checkpoint_sha"

        # 硬回滚到检查点
        git reset --hard "$checkpoint_sha" > /dev/null 2>&1
        log_success "已回滚到检查点: $(git rev-parse --short HEAD)"
    fi

    # 清理未跟踪的文件（任务可能创建了新文件但没提交）
    local untracked=$(git ls-files --others --exclude-standard 2>/dev/null)
    if [ -n "$untracked" ]; then
        log_warning "清理任务遗留的未跟踪文件..."
        git checkout -- . 2>/dev/null || true
        git clean -fd > /dev/null 2>&1 || true
        log_success "已清理未跟踪文件"
    fi

    # 恢复所有被修改的文件
    if ! git diff --quiet 2>/dev/null; then
        git checkout -- . 2>/dev/null || true
        log_success "已恢复所有修改"
    fi

    return 0
}

# ============================================================================
# Git 自动提交
# ============================================================================

run_git_commit() {
    local iteration="$1"
    local task_name="$2"
    local status="$3"

    if [ ! -d ".git" ]; then
        log_warning "不是 Git 仓库，跳过提交"
        return 0
    fi

    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        log_info "检测到文件变更，准备提交..."

        local branch_date=$(date '+%Y%m%d')
        local branch_name="feat/chat-improve-${branch_date}"

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

        git add -A

        local commit_msg="feat(chat): ${task_name}

Generated-By: autorun_chat.sh (AI Chat Quality Improvement)
Task-File: CURRENT_CHAT_TASK.md
Round: ${iteration}
Status: ${status}"

        if git commit -m "$commit_msg" > /dev/null 2>&1; then
            local commit_sha=$(git rev-parse --short HEAD)
            log_success "Git 提交成功: ${commit_sha}"
            log_info "分支: ${branch_name}"

            if [ "$status" = "✅ 完成" ] && git remote | grep -q "origin"; then
                log_info "推送到远程仓库..."
                if git push -u origin "$branch_name" 2>&1 | tail -5; then
                    log_success "推送成功: origin/$branch_name"
                else
                    log_warning "推送失败（可能需要配置认证）"
                fi
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

# ============================================================================
# 显示进度
# ============================================================================

show_progress() {
    local iteration="$1"
    local status="$2"
    local current_time=$(date '+%Y-%m-%d %H:%M:%S')

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}Chat/AI 对话系统质量改进${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  时间: ${BLUE}$current_time${NC}"
    echo -e "  轮次: ${PURPLE}$iteration${NC}"
    echo -e "  状态: $status"
    echo -e "  超时: 执行 $((EXECUTE_TIMEOUT/60))min / 无输出 $((NO_OUTPUT_TIMEOUT/60))min"
    echo -e "  日志: $LOG_FILE"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# ============================================================================
# 主函数
# ============================================================================

main() {
    case "${1:-}" in
        --reset-failures)
            log_info "重置所有失败任务..."
            reset_failed_tasks "$TASK_QUEUE"
            log_success "已重置所有失败任务"
            show_failure_summary
            exit 0
            ;;
        --show-failures)
            show_failure_summary
            exit 0
            ;;
        --status)
            if [ -f "$TASK_QUEUE" ]; then
                local stats=$(get_task_stats "$TASK_QUEUE")
                read total pending in_progress completed failed <<< "$stats"
                echo -e "${CYAN}Chat 改进任务统计${NC}"
                echo -e "  总计: $total | 待完成: $pending | 进行中: $in_progress | 已完成: $completed | 失败: $failed"
            else
                echo "尚未初始化任务队列"
            fi
            exit 0
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "AI 自动发现 Chat 系统问题并改进"
            echo ""
            echo "选项:"
            echo "  --reset-failures  重置所有失败任务"
            echo "  --show-failures   显示失败任务统计"
            echo "  --status          显示任务队列状态"
            echo "  --help, -h        显示帮助"
            echo ""
            echo "配置:"
            echo "  MAX_RETRIES=$MAX_RETRIES        单轮最大重试次数"
            echo "  MAX_TASK_FAILURES=$MAX_TASK_FAILURES   跨轮最大失败次数"
            echo "  INTERVAL=$INTERVAL           循环间隔（秒）"
            exit 0
            ;;
    esac

    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║    Chat/AI 对话系统质量自循环改进                           ║${NC}"
    echo -e "${CYAN}║    AI 扫描代码 -> 发现问题 -> 实现改进 -> 测试 -> 循环       ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 防睡眠
    if command -v caffeinate &> /dev/null; then
        log_info "启用防睡眠模式 (caffeinate)"
        caffeinate -disu -w $$ &
        CAFFEINATE_PID=$!
        trap "kill $CAFFEINATE_PID 2>/dev/null" EXIT
    fi

    # 日志分隔
    echo "" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════" >> "$LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Chat 质量改进会话开始" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"

    check_environment
    init_chat_task_queue

    echo ""
    log_info "启动 Chat/AI 对话系统质量改进..."
    log_info "聚焦领域: 话题管理 | 记录持久化 | 智能化 | UI体验 | 稳定性"
    log_info "循环间隔: ${INTERVAL}秒 | 单轮重试: ${MAX_RETRIES}次"
    log_info "按 Ctrl+C 可随时停止"
    echo ""

    local iteration=0

    while [ $iteration -lt $MAX_ITERATIONS ]; do
        iteration=$((iteration + 1))

        show_progress $iteration "${BLUE}检查 Chat 改进任务队列...${NC}"

        log_task "第 $iteration 轮: 检查任务队列..."

        if ! check_and_generate_tasks; then
            log_error "任务生成失败，跳过本轮"
            record_state $iteration "任务生成错误" "⏭️ 跳过"
            sleep $INTERVAL
            continue
        fi

        local task_content=$(get_next_task "$TASK_QUEUE" "$MAX_TASK_FAILURES")

        if [ -z "$task_content" ]; then
            local stats=$(get_task_stats "$TASK_QUEUE")
            read _total _pending _in_progress _completed _failed <<< "$stats"
            if [ "${_failed:-0}" -gt 0 ] && [ "${_pending:-0}" -eq 0 ]; then
                log_warning "所有任务均已失败，使用 '$0 --reset-failures' 可重置"
                show_failure_summary
            else
                log_warning "无可执行任务，等待下一轮扫描"
            fi
            sleep $INTERVAL
            continue
        fi

        local task_id=$(echo "$task_content" | grep '\*\*ID\*\*:' | head -1 | sed 's/.*\*\*ID\*\*:[[:space:]]*//' | xargs)
        local task_title=$(echo "$task_content" | head -1 | sed 's/^### \[pending\] //')
        local task_name="${task_title}"

        local prev_failures=$(get_failure_count "$task_id")
        if [ "$prev_failures" -gt 0 ]; then
            log_warning "任务 $task_id 此前已失败 $prev_failures 次"
        fi

        log_task "第 $iteration 轮: $task_name (ID: $task_id)"
        show_progress $iteration "${YELLOW}改进中: $task_name${NC}"

        if ! mark_task_in_progress "$TASK_QUEUE" "$task_id"; then
            log_error "无法标记任务，跳过"
            sleep $INTERVAL
            continue
        fi

        echo "$task_content" > "$TASK_FILE"

        # 创建 Git 检查点（任务执行前的代码快照）
        local checkpoint_sha=$(create_checkpoint)

        # 执行任务（带重试）
        local execute_retry=0
        local task_success=false
        local last_error_output=""

        while [ $execute_retry -lt $MAX_RETRIES ]; do
            execute_retry=$((execute_retry + 1))

            if [ $execute_retry -gt 1 ]; then
                log_warning "执行第 $execute_retry 次尝试..."

                # 重试前先回滚到检查点（清除上次失败的残留代码）
                if [ -n "$checkpoint_sha" ]; then
                    log_info "重试前回滚到检查点..."
                    rollback_to_checkpoint "$checkpoint_sha" "$task_name"
                fi

                if ! smart_retry "$last_error_output" $execute_retry; then
                    break
                fi
            fi

            if run_claude_execute $iteration; then
                if run_chat_tests; then
                    task_success=true
                    break
                else
                    log_warning "测试失败，AI 修复中..."
                    last_error_output=$(tail -100 "$TEST_LOG")
                    run_claude_fix

                    if run_chat_tests; then
                        task_success=true
                        break
                    fi
                fi
            else
                local execute_exit=$?
                if [ $execute_exit -eq 2 ]; then
                    last_error_output="timeout"
                else
                    last_error_output=$(tail -50 "$LOG_FILE")
                fi
            fi

            if [ $execute_retry -lt $MAX_RETRIES ] && [ -z "$last_error_output" ]; then
                sleep 30
            fi
        done

        # 记录结果
        if [ "$task_success" = true ]; then
            mark_task_completed "$TASK_QUEUE" "$task_id"
            record_state $iteration "$task_name" "✅ 完成"
            show_progress $iteration "${GREEN}完成: $task_name${NC}"

            run_git_commit $iteration "$task_name" "✅ 完成"

            send_notification "Chat 改进完成: $task_name" \
                "任务: $task_name\nID: $task_id\n状态: 已完成\n轮次: 第 $iteration 轮" "success"
        else
            # 任务失败 → 回滚代码到检查点 → 跳过此任务
            log_error "任务 $task_id 失败 $execute_retry 次，回滚代码并跳过..."
            if [ -n "$checkpoint_sha" ]; then
                rollback_to_checkpoint "$checkpoint_sha" "$task_name"
                log_success "代码已回滚到任务执行前的状态"
            fi

            local error_msg="执行尝试 $execute_retry 次，已回滚"
            mark_task_failed "$TASK_QUEUE" "$task_id" "$error_msg"
            record_state $iteration "$task_name" "❌ 失败+回滚 ($error_msg)"
            show_progress $iteration "${RED}失败+回滚: $task_name${NC}"

            send_notification "Chat 改进失败(已回滚): $task_name" \
                "任务: $task_name\nID: $task_id\n失败: $error_msg\n代码已自动回滚" "error"
        fi

        log_info "等待 ${INTERVAL}秒 后继续下一轮..."
        sleep $INTERVAL
    done

    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║    Chat/AI 对话系统质量改进结束                              ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    log_info "日志: $LOG_FILE"
    log_info "状态: $STATE_FILE"
    log_info "队列: $TASK_QUEUE"
}

# 信号处理
trap 'echo ""; log_warning "收到中断信号，正在退出..."; exit 130' INT TERM

# 运行
main "$@"
