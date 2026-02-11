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
TASK_QUEUE="$PROJECT_DIR/TASK_QUEUE.md"             # 任务队列
TEST_LOG="$PROJECT_DIR/test.log"

# 配置
INTERVAL=30            # 循环间隔（秒）
MAX_ITERATIONS=1000    # 最大迭代次数
ANALYZE_TIMEOUT=3600   # 分析阶段超时（60分钟）
EXECUTE_TIMEOUT=3600   # 执行阶段超时（60分钟）
MAX_RETRIES=3          # 单任务单轮最大重试次数
MAX_TASK_FAILURES=3    # 同一任务跨轮次最大失败次数（超过后自动跳过）
BATCH_SIZE=5           # 每次生成任务数量

# Token 使用统计和成本控制
TOTAL_TOKENS=0                    # 总 Token 使用量
MAX_TOKENS=10000000                # 最大 Token 限制（100万）
COST_PER_1K_INPUT_TOKENS=0.003    # Claude 输入定价（美元/1K tokens）
COST_PER_1K_OUTPUT_TOKENS=0.015   # Claude 输出定价（美元/1K tokens）
TOKEN_LOG="$PROJECT_DIR/TOKEN_USAGE.log"  # Token 使用日志

# 通知配置
ENABLE_NOTIFICATION=true          # 是否启用邮件通知
NOTIFICATION_SCRIPT="$SCRIPT_DIR/send-notification.py"  # 通知脚本路径

# 加载任务队列辅助函数
source "$SCRIPT_DIR/task-queue-helper.sh"

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

# Token 使用统计函数
log_token_usage() {
    local input_tokens="${1:-0}"
    local output_tokens="${2:-0}"
    local operation="$3"

    # 累计 Token 使用量
    TOTAL_TOKENS=$((TOTAL_TOKENS + input_tokens + output_tokens))

    # 计算成本（美元）
    local input_cost=$(echo "scale=4; $input_tokens * $COST_PER_1K_INPUT_TOKENS / 1000" | bc)
    local output_cost=$(echo "scale=4; $output_tokens * $COST_PER_1K_OUTPUT_TOKENS / 1000" | bc)
    local operation_cost=$(echo "scale=4; $input_cost + $output_cost" | bc)
    local total_cost=$(echo "scale=2; $TOTAL_TOKENS * ($COST_PER_1K_INPUT_TOKENS + $COST_PER_1K_OUTPUT_TOKENS) / 2000" | bc)

    # 记录到日志
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $operation | 输入: $input_tokens | 输出: $output_tokens | 成本: \$$operation_cost | 累计: $TOTAL_TOKENS tokens (\$$total_cost)" >> "$TOKEN_LOG"

    # 显示统计信息
    log_info "Token 使用（估算，含上下文）- 输入: $input_tokens, 输出: $output_tokens, 本次成本: \$$operation_cost"
    log_info "累计 Token: $TOTAL_TOKENS (\$$total_cost) / 限制: $MAX_TOKENS"

    # 检查是否超限
    if [ $TOTAL_TOKENS -gt $MAX_TOKENS ]; then
        log_error "已达到 Token 限制 ($MAX_TOKENS)，停止执行以避免高额费用"
        log_error "累计成本: \$$total_cost"
        exit 1
    fi

    # 警告：当使用量达到80%时
    local usage_percent=$((TOTAL_TOKENS * 100 / MAX_TOKENS))
    if [ $usage_percent -ge 80 ] && [ $usage_percent -lt 90 ]; then
        log_warning "Token 使用已达 ${usage_percent}%，接近限制"
    elif [ $usage_percent -ge 90 ]; then
        log_warning "⚠️  Token 使用已达 ${usage_percent}%，即将达到限制！"
    fi
}

# 估算 Token 使用量（基于字符数的粗略估算）
estimate_tokens() {
    local text="$1"
    local char_count=${#text}

    # Claude tokenization 规则：
    # - 英文：约 4 字符/token
    # - 中文：约 1.5-2 字符/token
    # - 代码：约 2.5-3 字符/token
    #
    # 对于混合内容（中文prompt + 英文代码 + 中文注释），使用 2.2 作为平均值
    #
    # ⚠️ 重要：Claude Code CLI 会自动添加大量上下文（项目文件、系统prompt等）
    # 实际 token 使用量通常是我们看到的 3-5 倍
    # 因此我们使用一个 CONTEXT_MULTIPLIER 来近似这部分开销

    local base_tokens=$((char_count * 10 / 22))  # char_count / 2.2

    # Claude Code CLI 上下文倍数（保守估计为 4 倍）
    # 这包括：项目文件索引、系统prompt、工具定义、对话历史等
    local CONTEXT_MULTIPLIER=4

    echo $((base_tokens * CONTEXT_MULTIPLIER))
}

# 错误分类函数
classify_error() {
    local error_output="$1"

    if echo "$error_output" | grep -qi "network\|timeout\|connection\|ECONNREFUSED\|ETIMEDOUT"; then
        echo "network"  # 网络问题 → 重试
    elif echo "$error_output" | grep -qi "rate limit\|too many requests\|429"; then
        echo "rate_limit"  # API 限流 → 等待更长时间
    elif echo "$error_output" | grep -qi "authentication\|unauthorized\|401\|403"; then
        echo "auth"  # 认证问题 → 需要人工介入
    elif echo "$error_output" | grep -qi "out of memory\|ENOMEM"; then
        echo "memory"  # 内存问题
    elif echo "$error_output" | grep -qi "disk full\|ENOSPC"; then
        echo "disk"  # 磁盘空间问题
    else
        echo "unknown"
    fi
}

# 智能重试函数
smart_retry() {
    local error_output="$1"
    local retry_count="$2"
    local error_type=$(classify_error "$error_output")

    case "$error_type" in
        network)
            local wait_time=$((60 * retry_count))  # 网络问题：1分钟、2分钟、3分钟
            log_warning "检测到网络问题，等待 $wait_time 秒后重试..."
            sleep $wait_time
            return 0  # 可以重试
            ;;
        rate_limit)
            local wait_time=$((300 * retry_count))  # API 限流：5分钟、10分钟、15分钟
            log_warning "检测到 API 限流，等待 $((wait_time / 60)) 分钟后重试..."
            sleep $wait_time
            return 0  # 可以重试
            ;;
        auth)
            log_error "检测到认证失败，需要人工检查 API 密钥配置"
            return 1  # 不重试
            ;;
        memory)
            log_error "检测到内存不足，需要人工处理"
            return 1  # 不重试
            ;;
        disk)
            log_error "检测到磁盘空间不足，需要人工清理"
            return 1  # 不重试
            ;;
        *)
            local wait_time=30
            log_warning "未知错误类型，等待 $wait_time 秒后重试..."
            sleep $wait_time
            return 0  # 默认重试
            ;;
    esac
}

# 发送通知函数
send_notification() {
    local title="$1"
    local message="$2"
    local status="${3:-info}"  # success/error/info

    # 检查是否启用通知
    if [ "$ENABLE_NOTIFICATION" != "true" ]; then
        return 0
    fi

    # 检查 Python 和通知脚本是否存在
    if ! command -v python3 &> /dev/null; then
        log_warning "Python3 未安装，跳过邮件通知"
        return 1
    fi

    if [ ! -f "$NOTIFICATION_SCRIPT" ]; then
        log_warning "通知脚本不存在: $NOTIFICATION_SCRIPT"
        return 1
    fi

    # 发送通知（后台运行，不阻塞主流程）
    (
        python3 "$NOTIFICATION_SCRIPT" "$title" "$message" "$status" >> "$LOG_FILE" 2>&1
    ) &

    return 0
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

# 构建批量生成任务的 Prompt
build_batch_generate_prompt() {
    cat << 'EOF'
你是 ServerPilot 项目的 AI 开发助手。请分析项目当前状态，**批量生成**接下来要完成的任务。

## 项目目标

**产品方案**: docs/产品方案-目录.md - MVP 范围、优先级、技术栈概要
**完整方案**: docs/DevOps产品方案.md - 详细产品设计（需要时查阅）
**开发标准**: docs/开发标准.md - 技术架构、代码规范、Git 工作流、测试标准

## 你的任务

1. **阅读产品方案目录**: 读 docs/产品方案-目录.md，了解 MVP 范围和开发优先级
2. **遵循开发标准**: 查看 docs/开发标准.md，了解技术架构和代码规范
3. **分析当前代码**: 检查 packages/ 目录下各模块的实现状态
4. **批量生成任务**: 根据优先级生成 5-10 个待完成任务（按重要性排序）

## 输出格式

请严格按以下格式输出多个任务（用 `---` 分隔）：

```tasks
### [pending] 任务1标题

**ID**: task-001
**优先级**: P0
**模块路径**: packages/server/src/core/
**任务描述**: 详细说明要实现什么功能
**产品需求**: 对应产品方案中的哪个功能点
**验收标准**: 如何验证任务完成
**创建时间**: $(date '+%Y-%m-%d %H:%M:%S')
**完成时间**: -

---

### [pending] 任务2标题

**ID**: task-002
**优先级**: P0
**模块路径**: packages/server/src/db/
**任务描述**: ...
**产品需求**: ...
**验收标准**: ...
**创建时间**: $(date '+%Y-%m-%d %H:%M:%S')
**完成时间**: -

---

... (继续生成更多任务)
```

## 注意事项

- **任务粒度**: 每个任务 1-2 小时可完成
- **优先级**: 优先生成 P0 任务，然后 P1、P2
- **依赖关系**: 考虑任务之间的依赖，先生成基础任务
- **数量**: 生成 5-10 个任务（根据项目状态决定）
- **可执行性**: 每个任务描述要清晰、可独立执行

开始分析并生成任务列表...
EOF
}

# 批量生成任务并添加到队列
run_claude_batch_generate() {
    local prompt=$(build_batch_generate_prompt)
    local output_file=$(mktemp)

    log_ai "AI 正在批量生成任务..."

    # 估算输入 Token
    local input_tokens=$(estimate_tokens "$prompt")

    if echo "$prompt" | claude -p > "$output_file" 2>&1; then
        # 提取任务块
        local tasks_content=$(sed -n '/```tasks/,/```/p' "$output_file" | sed '1d;$d')

        if [ -n "$tasks_content" ]; then
            # 添加任务到队列
            add_tasks_to_queue "$TASK_QUEUE" "$tasks_content"

            # 估算输出 Token
            local output_tokens=$(estimate_tokens "$tasks_content")
            log_token_usage $input_tokens $output_tokens "批量生成任务"

            # 显示统计
            local stats=$(get_task_stats "$TASK_QUEUE")
            read total pending in_progress completed failed <<< "$stats"
            log_success "成功生成 $pending 个新任务"
            log_info "任务队列: 总计 $total | 待完成 $pending | 进行中 $in_progress | 已完成 $completed | 失败 $failed"

            rm -f "$output_file"
            return 0
        else
            log_error "AI 未能生成有效任务格式"
            cat "$output_file"
            rm -f "$output_file"
            return 1
        fi
    else
        log_error "AI 批量生成任务失败"
        cat "$output_file"
        rm -f "$output_file"
        return 1
    fi
}

# 检查并生成任务
check_and_generate_tasks() {
    local stats=$(get_task_stats "$TASK_QUEUE")
    read total pending in_progress completed failed <<< "$stats"

    # 确保变量有默认值
    pending="${pending:-0}"
    in_progress="${in_progress:-0}"
    total="${total:-0}"
    completed="${completed:-0}"
    failed="${failed:-0}"

    # 有待执行或进行中的任务 → 直接继续
    if [ "$pending" -gt 0 ] || [ "$in_progress" -gt 0 ]; then
        log_info "任务队列状态: 总计 $total | 待完成 $pending | 进行中 $in_progress | 已完成 $completed | 失败 $failed"
        return 0
    fi

    # 没有 pending 也没有 in_progress，但有 failed → 尝试重试
    if [ "$failed" -gt 0 ]; then
        local retryable=$(count_retryable_failed_tasks "$TASK_QUEUE" "$MAX_TASK_FAILURES")
        if [ "$retryable" -gt 0 ]; then
            log_info "发现 $retryable 个可重试的失败任务（失败次数 < $MAX_TASK_FAILURES），自动重置为 pending..."
            retry_eligible_failed_tasks "$TASK_QUEUE" "$MAX_TASK_FAILURES"
            return 0
        else
            log_warning "所有失败任务均已超过重试上限 ($MAX_TASK_FAILURES 次)"
            log_info "跳过失败任务，开始生成新任务..."
        fi
    fi

    # 无任何可执行任务 → 批量生成新任务
    log_info "任务队列为空，开始批量生成任务..."
    run_claude_batch_generate
    return $?
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

            # Token 统计
            local input_tokens=$(estimate_tokens "$prompt")
            local output_tokens=$(estimate_tokens "$task_block")
            log_token_usage $input_tokens $output_tokens "任务分析"

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

    # Token 统计
    if [ $exit_code -eq 0 ]; then
        local input_tokens=$(estimate_tokens "$prompt")
        local output_content=$(cat "$output_file" 2>/dev/null || echo "")
        local output_tokens=$(estimate_tokens "$output_content")
        log_token_usage $input_tokens $output_tokens "任务执行"
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

# 增量测试 - 只测试变更的模块
run_incremental_tests() {
    log_info "运行增量测试（智能检测变更模块）..."

    if [ ! -f "package.json" ]; then
        log_warning "package.json 不存在，跳过测试"
        return 0
    fi

    if ! grep -q '"test"' package.json; then
        log_warning "测试脚本未配置，跳过测试"
        return 0
    fi

    # 检查是否是 git 仓库
    if [ ! -d ".git" ]; then
        log_warning "不是 Git 仓库，运行全量测试"
        run_tests
        return $?
    fi

    # 检测变更的文件
    local changed_files=$(git diff --name-only HEAD 2>/dev/null || git ls-files --others --exclude-standard)

    if [ -z "$changed_files" ]; then
        log_info "没有文件变更，跳过测试"
        return 0
    fi

    log_info "检测到以下文件变更:"
    echo "$changed_files" | sed 's/^/  - /'

    # 判断需要测试的模块
    local test_server=false
    local test_agent=false
    local test_dashboard=false
    local test_shared=false
    local test_all=false

    while IFS= read -r file; do
        if echo "$file" | grep -q "^packages/server/"; then
            test_server=true
        elif echo "$file" | grep -q "^packages/agent/"; then
            test_agent=true
        elif echo "$file" | grep -q "^packages/dashboard/"; then
            test_dashboard=true
        elif echo "$file" | grep -q "^packages/shared/"; then
            test_shared=true
            test_all=true  # shared 模块变更，影响全部
        fi
    done <<< "$changed_files"

    # 如果 shared 模块变更，运行全量测试
    if [ "$test_all" = true ]; then
        log_warning "检测到 shared 模块变更，运行全量测试"
        run_tests
        return $?
    fi

    # 运行对应模块的测试
    local test_failed=false

    if [ "$test_server" = true ]; then
        log_info "测试 server 模块..."
        if pnpm --filter @serverpilot/server test > "$TEST_LOG" 2>&1; then
            log_success "server 模块测试通过"
        else
            log_error "server 模块测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_agent" = true ]; then
        log_info "测试 agent 模块..."
        if pnpm --filter @serverpilot/agent test >> "$TEST_LOG" 2>&1; then
            log_success "agent 模块测试通过"
        else
            log_error "agent 模块测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_dashboard" = true ]; then
        log_info "测试 dashboard 模块..."
        if pnpm --filter @serverpilot/dashboard test >> "$TEST_LOG" 2>&1; then
            log_success "dashboard 模块测试通过"
        else
            log_error "dashboard 模块测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_failed" = true ]; then
        log_error "增量测试失败"
        tail -50 "$TEST_LOG"
        return 1
    else
        log_success "增量测试全部通过"
        return 0
    fi
}

# 运行测试（全量测试）
run_tests() {
    log_info "运行全量测试..."

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
    # 处理命令行参数
    case "${1:-}" in
        --reset-failures)
            log_info "重置所有失败任务..."
            reset_failed_tasks "$TASK_QUEUE"
            log_success "已重置所有失败任务为 pending 状态"
            show_failure_summary
            exit 0
            ;;
        --show-failures)
            show_failure_summary
            exit 0
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "选项:"
            echo "  --reset-failures  重置所有失败任务为 pending 状态"
            echo "  --show-failures   显示失败任务统计"
            echo "  --help, -h        显示帮助信息"
            echo ""
            echo "配置:"
            echo "  MAX_RETRIES=$MAX_RETRIES        单轮最大重试次数"
            echo "  MAX_TASK_FAILURES=$MAX_TASK_FAILURES   跨轮次最大失败次数"
            echo "  INTERVAL=$INTERVAL           循环间隔（秒）"
            exit 0
            ;;
    esac

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
    log_info "单轮重试: ${MAX_RETRIES}次 | 跨轮失败上限: ${MAX_TASK_FAILURES}次"
    log_info "按 Ctrl+C 可随时停止"
    echo ""

    local iteration=0

    # 主循环
    while [ $iteration -lt $MAX_ITERATIONS ]; do
        iteration=$((iteration + 1))

        show_progress $iteration "${BLUE}检查任务队列...${NC}"

        # 步骤1: 检查任务队列，如果为空则批量生成任务
        log_task "第 $iteration 轮: 检查任务队列..."

        if ! check_and_generate_tasks; then
            log_error "任务队列检查/生成失败，跳过本轮"
            record_state $iteration "任务队列错误" "⏭️ 跳过 (任务队列错误)"
            show_progress $iteration "${RED}跳过: 任务队列错误${NC}"
            log_info "等待 ${INTERVAL}秒 后继续下一轮..."
            sleep $INTERVAL
            continue
        fi

        # 步骤2: 从队列获取下一个任务（自动跳过超过失败上限的任务）
        local task_content=$(get_next_task "$TASK_QUEUE" "$MAX_TASK_FAILURES")

        if [ -z "$task_content" ]; then
            # 区分"无任务"和"全部失败"
            local stats=$(get_task_stats "$TASK_QUEUE")
            read _total _pending _in_progress _completed _failed <<< "$stats"
            if [ "${_failed:-0}" -gt 0 ] && [ "${_pending:-0}" -eq 0 ]; then
                log_warning "所有待执行任务均已失败，无可执行任务"
                log_info "使用 '$0 --reset-failures' 可重置失败任务重新尝试"
                show_failure_summary
            else
                log_warning "任务队列为空，等待下一轮重新生成"
            fi
            sleep $INTERVAL
            continue
        fi

        # 提取任务信息（使用更宽容的匹配模式）
        local task_id=$(echo "$task_content" | grep '\*\*ID\*\*:' | head -1 | sed 's/.*\*\*ID\*\*:[[:space:]]*//' | xargs)
        local task_title=$(echo "$task_content" | head -1 | sed 's/^### \[pending\] //')
        local task_name="${task_title}"

        if [ -z "$task_id" ]; then
            log_warning "无法提取任务 ID，使用任务标题作为标识: $task_name"
        fi

        # 显示失败历史（如果有）
        local prev_failures=$(get_failure_count "$task_id")
        if [ "$prev_failures" -gt 0 ]; then
            log_warning "任务 $task_id 此前已失败 $prev_failures 次 (上限: $MAX_TASK_FAILURES)"
        fi

        log_task "第 $iteration 轮: $task_name (ID: $task_id)"
        show_progress $iteration "${YELLOW}执行中: $task_name${NC}"

        # 标记任务为进行中（传入 task_id 精确定位）
        if ! mark_task_in_progress "$TASK_QUEUE" "$task_id"; then
            log_error "无法标记任务为进行中，跳过本轮"
            sleep $INTERVAL
            continue
        fi

        # 将任务内容写入 TASK_FILE 供执行使用
        echo "$task_content" > "$TASK_FILE"

        # 步骤3: AI 执行任务（带智能重试）
        local execute_retry=0
        local task_success=false
        local last_error_output=""

        while [ $execute_retry -lt $MAX_RETRIES ]; do
            execute_retry=$((execute_retry + 1))

            if [ $execute_retry -gt 1 ]; then
                log_warning "执行阶段第 $execute_retry 次尝试..."
                # 使用智能重试策略
                if ! smart_retry "$last_error_output" $execute_retry; then
                    log_error "错误类型不支持重试，停止尝试"
                    break
                fi
            fi

            if run_claude_execute $iteration; then
                # 步骤4: 运行增量测试
                if run_incremental_tests; then
                    task_success=true
                    break
                else
                    # 测试失败，让AI修复
                    log_warning "测试失败，尝试让 AI 修复..."
                    last_error_output=$(tail -100 "$TEST_LOG")
                    run_claude_fix

                    # 再次运行测试
                    if run_incremental_tests; then
                        task_success=true
                        break
                    fi
                fi
            else
                local execute_exit=$?
                if [ $execute_exit -eq 2 ]; then
                    log_error "执行阶段超时"
                    last_error_output="timeout"
                else
                    log_error "执行阶段失败"
                    # 获取错误输出用于智能重试判断
                    last_error_output=$(tail -50 "$LOG_FILE")
                fi
            fi

            if [ $execute_retry -lt $MAX_RETRIES ]; then
                # 如果不是智能重试决定等待，则默认等待30秒
                if [ -z "$last_error_output" ]; then
                    log_warning "等待30秒后重试执行..."
                    sleep 30
                fi
            fi
        done

        # 记录状态并更新任务队列
        if [ "$task_success" = true ]; then
            # 标记任务为完成
            mark_task_completed "$TASK_QUEUE" "$task_id"
            record_state $iteration "$task_name" "✅ 完成"
            show_progress $iteration "${GREEN}完成: $task_name${NC}"

            # Git 自动提交（仅在任务成功时）
            log_info "步骤 5: Git 提交变更..."
            run_git_commit $iteration "$task_name" "✅ 完成"

            # 发送成功通知
            local success_msg="任务: $task_name
ID: $task_id
状态: 已完成
轮次: 第 $iteration 轮
时间: $(date '+%Y-%m-%d %H:%M:%S')

✅ 任务执行成功，测试通过，已提交到 Git。"
            send_notification "任务完成: $task_name" "$success_msg" "success"
        else
            # 标记任务为失败
            local error_msg="执行阶段尝试 $execute_retry 次"
            mark_task_failed "$TASK_QUEUE" "$task_id" "$error_msg"
            record_state $iteration "$task_name" "❌ 失败 ($error_msg)"
            show_progress $iteration "${RED}失败: $task_name${NC}"

            # 发送失败通知
            local failure_msg="任务: $task_name
ID: $task_id
状态: 失败
轮次: 第 $iteration 轮
重试次数: $execute_retry
时间: $(date '+%Y-%m-%d %H:%M:%S')

❌ 任务执行失败，已标记为失败状态。

错误摘要:
$(echo "$last_error_output" | head -20)"
            send_notification "任务失败: $task_name" "$failure_msg" "error"
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
