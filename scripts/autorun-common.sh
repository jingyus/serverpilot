#!/bin/bash
#
# autorun 公共基础设施
#
# 所有 autorun_*.sh 脚本的共享模块。提供：
# - 日志、颜色、Token 统计
# - 错误分类与智能重试、进程卡死检测
# - 通知、Git 检查点/回滚/提交
# - Claude 执行（超时 + 卡死检测）、测试辅助
# - 任务队列管理、主循环
#
# 使用方式（在具体脚本中）：
#   1. 设置 SCRIPT_DIR / PROJECT_DIR
#   2. 设置模块配置变量（MODULE_NAME, LOG_FILE 等）
#   3. 定义钩子函数（build_discover_prompt 等）
#   4. source autorun-common.sh
#   5. 调用 autorun_main "$@"
#
# 必须由调用脚本提供的变量：
#   MODULE_NAME      — 显示名称（如 "Chat/AI 对话系统"）
#   BRANCH_PREFIX    — Git 分支前缀（如 "feat/chat-improve"）
#   COMMIT_PREFIX    — Git 提交前缀（如 "feat(chat)"）
#   COMMIT_GENERATED — Generated-By 标记
#   LOG_FILE, STATE_FILE, TASK_FILE, TASK_QUEUE, TEST_LOG, TOKEN_LOG
#
# 必须由调用脚本提供的钩子函数：
#   build_discover_prompt       — 任务发现/批量生成 prompt
#   build_execute_prompt <task> — 任务执行 prompt
#   build_fix_prompt <output>   — 测试修复 prompt
#   module_check_environment    — 模块专用环境检查
#   module_init_queue_header    — echo 任务队列初始内容
#   module_run_tests            — 运行模块测试，返回 0/1
#   module_banner_info          — 启动时额外信息行（可选）
#   module_progress_extra       — 进度条额外行（可选）

# ============================================================================
# 颜色定义
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# ============================================================================
# 初始化
# ============================================================================

cd "$PROJECT_DIR"

# 默认配置（调用脚本可覆盖）
INTERVAL="${INTERVAL:-30}"
MAX_ITERATIONS="${MAX_ITERATIONS:-1000}"
EXECUTE_TIMEOUT="${EXECUTE_TIMEOUT:-3600}"
NO_OUTPUT_TIMEOUT="${NO_OUTPUT_TIMEOUT:-3600}"
STUCK_CHECK_AFTER="${STUCK_CHECK_AFTER:-1200}"
STUCK_CONFIRM_TIME="${STUCK_CONFIRM_TIME:-300}"
MAX_RETRIES="${MAX_RETRIES:-3}"
MAX_TASK_FAILURES="${MAX_TASK_FAILURES:-3}"
TOTAL_TOKENS=0
MAX_TOKENS="${MAX_TOKENS:-10000000}"
COST_PER_1K_INPUT_TOKENS="${COST_PER_1K_INPUT_TOKENS:-0.003}"
COST_PER_1K_OUTPUT_TOKENS="${COST_PER_1K_OUTPUT_TOKENS:-0.015}"
ENABLE_NOTIFICATION="${ENABLE_NOTIFICATION:-true}"
NOTIFICATION_SCRIPT="${NOTIFICATION_SCRIPT:-$SCRIPT_DIR/send-notification.py}"

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
# 通用环境检查
# ============================================================================

_check_common_environment() {
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

    # 调用模块专用环境检查
    module_check_environment
}

# ============================================================================
# 状态记录
# ============================================================================

init_state_file() {
    if [ ! -f "$STATE_FILE" ]; then
        cat > "$STATE_FILE" << EOF
# ${MODULE_NAME}改进日志

> AI 自动发现并改进的记录

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
# 任务队列初始化
# ============================================================================

_init_task_queue() {
    if [ -f "$TASK_QUEUE" ]; then
        return 0
    fi

    module_init_queue_header > "$TASK_QUEUE"
    log_success "初始化任务队列: $TASK_QUEUE"
}

# ============================================================================
# 批量生成任务
# ============================================================================

run_claude_batch_generate() {
    local prompt=$(build_discover_prompt)
    local output_file=$(mktemp)

    log_ai "AI 正在扫描 ${MODULE_NAME}，发现问题和改进空间..."

    local input_tokens=$(estimate_tokens "$prompt")

    if echo "$prompt" | claude -p > "$output_file" 2>&1; then
        # 解析策略 1: ```tasks ... ```
        local tasks_content=$(sed -n '/```tasks/,/```/p' "$output_file" | sed '1d;$d')

        # 解析策略 2: 任意 ``` ... ``` 中包含 [pending]
        if [ -z "$tasks_content" ]; then
            tasks_content=$(sed -n '/^```/,/^```/p' "$output_file" | sed '1d;$d')
            if ! echo "$tasks_content" | grep -q '^\### \[pending\]'; then
                tasks_content=""
            fi
        fi

        # 解析策略 3: 直接提取 ### [pending] 块
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
            log_token_usage $input_tokens $output_tokens "${MODULE_NAME}扫描"

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
        log_error "AI ${MODULE_NAME}扫描失败"
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

    if [ "$in_progress" -gt 0 ] && [ "$pending" -eq 0 ]; then
        local reset_count=$(reset_stale_in_progress_tasks "$TASK_QUEUE")
        log_warning "恢复 $reset_count 个上次中断遗留的 in_progress 任务为 pending"
        stats=$(get_task_stats "$TASK_QUEUE")
        read total pending in_progress completed failed <<< "$stats"
        pending="${pending:-0}"
        in_progress="${in_progress:-0}"
    fi

    if [ "$pending" -gt 0 ]; then
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

    log_info "任务队列为空，AI 开始新一轮扫描..."
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

    log_ai "AI 正在执行任务... (超时: $((EXECUTE_TIMEOUT/60))分钟)"
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
                    _kill_process_tree $claude_pid
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
                    _kill_process_tree $claude_pid
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
            _kill_process_tree $claude_pid
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
        log_token_usage $input_tokens $output_tokens "${MODULE_NAME}执行"
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

# 终止进程树
_kill_process_tree() {
    local pid="$1"
    pkill -TERM -P $pid 2>/dev/null || true
    sleep 2
    pkill -KILL -P $pid 2>/dev/null || true
    kill -9 $pid 2>/dev/null || true
}

# ============================================================================
# 智能测试辅助 — 解析 vitest 输出判断真实结果
# ============================================================================

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

    if [ $exit_code -eq 0 ]; then
        return 0
    fi

    if grep -q "No test files found" "$log_file"; then
        log_warning "$module: vitest 未找到测试文件，视为通过"
        return 0
    fi

    local summary_line=$(grep -E "^\s*Tests\s+" "$log_file" | tail -1)
    if [ -n "$summary_line" ]; then
        if echo "$summary_line" | grep -qE "[0-9]+ failed"; then
            return 1
        fi
        if echo "$summary_line" | grep -qE "[0-9]+ passed"; then
            log_warning "$module: 所有测试通过但 exit code=$exit_code (stderr 噪音)，视为通过"
            return 0
        fi
    fi

    return $exit_code
}

# ============================================================================
# Claude 修复测试
# ============================================================================

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

# ============================================================================
# Git 检查点 & 回滚
# ============================================================================

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

    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
        git stash push --include-untracked -m "autorun checkpoint $(date '+%Y%m%d_%H%M%S')" > /dev/null 2>&1
        checkpoint_sha=$(git rev-parse HEAD 2>/dev/null)
        git stash pop > /dev/null 2>&1 || true
    fi

    log_info "检查点: $checkpoint_sha ($(git log --oneline -1 HEAD 2>/dev/null | cut -c1-60))"
    echo "$checkpoint_sha"
}

rollback_to_checkpoint() {
    local checkpoint_sha="$1"
    local task_name="$2"

    if [ -z "$checkpoint_sha" ] || [ ! -d ".git" ]; then
        log_warning "无检查点信息，无法回滚"
        return 1
    fi

    local current_sha=$(git rev-parse HEAD 2>/dev/null)

    if [ "$current_sha" != "$checkpoint_sha" ]; then
        local new_commits=$(git rev-list --count "${checkpoint_sha}..HEAD" 2>/dev/null || echo "0")
        log_warning "回滚 $new_commits 个失败任务的提交..."
        git reset --hard "$checkpoint_sha" > /dev/null 2>&1
        log_success "已回滚到检查点: $(git rev-parse --short HEAD)"
    fi

    local untracked=$(git ls-files --others --exclude-standard 2>/dev/null)
    if [ -n "$untracked" ]; then
        log_warning "清理任务遗留的未跟踪文件..."
        git checkout -- . 2>/dev/null || true
        git clean -fd > /dev/null 2>&1 || true
        log_success "已清理未跟踪文件"
    fi

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
        local branch_name="${BRANCH_PREFIX}-${branch_date}"

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

        local commit_msg="${COMMIT_PREFIX}: ${task_name}

Generated-By: ${COMMIT_GENERATED}
Task-File: $(basename "$TASK_FILE")
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
    echo -e "${CYAN}${MODULE_NAME}${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  时间: ${BLUE}$current_time${NC}"
    echo -e "  轮次: ${PURPLE}$iteration${NC}"
    echo -e "  状态: $status"
    echo -e "  超时: 执行 $((EXECUTE_TIMEOUT/60))min / 无输出 $((NO_OUTPUT_TIMEOUT/60))min"
    # 模块额外信息（可选钩子）
    if type module_progress_extra &>/dev/null; then
        module_progress_extra
    fi
    echo -e "  日志: $LOG_FILE"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# ============================================================================
# 主函数
# ============================================================================

autorun_main() {
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
                echo -e "${CYAN}${MODULE_NAME}任务统计${NC}"
                echo -e "  总计: $total | 待完成: $pending | 进行中: $in_progress | 已完成: $completed | 失败: $failed"
            else
                echo "尚未初始化任务队列"
            fi
            exit 0
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "AI 自动发现并改进 ${MODULE_NAME}"
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
            # 模块额外帮助（可选）
            if type module_help_extra &>/dev/null; then
                module_help_extra
            fi
            exit 0
            ;;
    esac

    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║    ${MODULE_NAME} 质量自循环改进${NC}"
    echo -e "${CYAN}║    AI 扫描 -> 发现问题 -> 实现改进 -> 测试 -> 循环${NC}"
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
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${MODULE_NAME} 改进会话开始" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"

    _check_common_environment
    _init_task_queue

    echo ""
    log_info "启动 ${MODULE_NAME} 质量改进..."
    if type module_banner_info &>/dev/null; then
        module_banner_info
    fi
    log_info "循环间隔: ${INTERVAL}秒 | 单轮重试: ${MAX_RETRIES}次"
    log_info "按 Ctrl+C 可随时停止"
    echo ""

    local iteration=0

    while [ $iteration -lt $MAX_ITERATIONS ]; do
        iteration=$((iteration + 1))

        show_progress $iteration "${BLUE}检查任务队列...${NC}"
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

        local checkpoint_sha=$(create_checkpoint)

        # 执行任务（带重试）
        local execute_retry=0
        local task_success=false
        local last_error_output=""

        while [ $execute_retry -lt $MAX_RETRIES ]; do
            execute_retry=$((execute_retry + 1))

            if [ $execute_retry -gt 1 ]; then
                log_warning "执行第 $execute_retry 次尝试..."

                if [ -n "$checkpoint_sha" ]; then
                    log_info "重试前回滚到检查点..."
                    rollback_to_checkpoint "$checkpoint_sha" "$task_name"
                fi

                if ! smart_retry "$last_error_output" $execute_retry; then
                    break
                fi
            fi

            if run_claude_execute $iteration; then
                if module_run_tests; then
                    task_success=true
                    break
                else
                    log_warning "测试失败，AI 修复中..."
                    last_error_output=$(tail -100 "$TEST_LOG")
                    run_claude_fix

                    if module_run_tests; then
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

            send_notification "${MODULE_NAME}改进完成: $task_name" \
                "任务: $task_name\nID: $task_id\n状态: 已完成\n轮次: 第 $iteration 轮" "success"
        else
            log_error "任务 $task_id 失败 $execute_retry 次，回滚代码并跳过..."
            if [ -n "$checkpoint_sha" ]; then
                rollback_to_checkpoint "$checkpoint_sha" "$task_name"
                log_success "代码已回滚到任务执行前的状态"
            fi

            local error_msg="执行尝试 $execute_retry 次，已回滚"
            mark_task_failed "$TASK_QUEUE" "$task_id" "$error_msg"
            record_state $iteration "$task_name" "❌ 失败+回滚 ($error_msg)"
            show_progress $iteration "${RED}失败+回滚: $task_name${NC}"

            send_notification "${MODULE_NAME}改进失败(已回滚): $task_name" \
                "任务: $task_name\nID: $task_id\n失败: $error_msg\n代码已自动回滚" "error"
        fi

        log_info "等待 ${INTERVAL}秒 后继续下一轮..."
        sleep $INTERVAL
    done

    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║    ${MODULE_NAME} 质量改进结束${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    log_info "日志: $LOG_FILE"
    log_info "状态: $STATE_FILE"
    log_info "队列: $TASK_QUEUE"
}

# 信号处理
trap 'echo ""; log_warning "收到中断信号，正在退出..."; exit 130' INT TERM
