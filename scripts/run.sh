#!/bin/bash
#
# ServerPilot 自动化开发脚本
# 使用 Claude Code 自动完成开发任务
#
# 用法: ./run.sh
#
# 工作流程:
# 1. 读取 docs/TODO.md 中的待完成任务
# 2. 使用 Claude Code 自动执行每个任务
# 3. 运行测试验证
# 4. 更新任务状态
#

# 注意: 不使用 set -e，因为我们需要处理失败并继续
# 每个关键操作都会手动检查返回值

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 项目目录（脚本所在目录的上级目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# 文件路径
TODO_FILE="$PROJECT_DIR/docs/TODO.md"
LOG_FILE="$PROJECT_DIR/dev.log"
TEST_LOG="$PROJECT_DIR/test.log"
STATE_FILE="$PROJECT_DIR/STATE.md"
FAILED_LOG="$PROJECT_DIR/FAILED_TASKS.md"
PROMPT_FILE="$PROJECT_DIR/docs/PROMPT.md"

# 函数: 打印带颜色的消息
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO: $1" >> "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS: $1" >> "$LOG_FILE"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >> "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: $1" >> "$LOG_FILE"
}

log_task() {
    echo -e "${PURPLE}📋 $1${NC}"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] TASK: $1" >> "$LOG_FILE"
}

# 函数: 检查环境
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

    # 检查 TODO.md 文件
    if [ ! -f "$TODO_FILE" ]; then
        log_error "TODO 文件不存在: $TODO_FILE"
        exit 1
    fi
    log_success "TODO 文件: $TODO_FILE"
}

# 函数: 获取下一个未完成的任务
get_next_task() {
    # 查找第一个 ⬜ 待开发 标记的任务行
    local task=$(grep -n "⬜ 待开发" "$TODO_FILE" | head -1)

    if [ -z "$task" ]; then
        echo ""
        return 1
    fi

    # 提取任务描述
    # 格式: | 任务名 | 路径 | ⬜ 待开发 | 说明 |
    local line_content=$(echo "$task" | cut -d':' -f2-)
    local task_name=$(echo "$line_content" | cut -d'|' -f2 | xargs)
    local task_path=$(echo "$line_content" | cut -d'|' -f3 | xargs)
    local task_desc=$(echo "$line_content" | cut -d'|' -f5 | xargs)

    if [ -n "$task_name" ] && [ "$task_name" != "任务" ]; then
        echo "$task_name: $task_desc ($task_path)"
    fi
}

# 函数: 检查是否还有未完成任务
has_pending_tasks() {
    grep -q "⬜ 待开发" "$TODO_FILE" 2>/dev/null
    return $?
}

# 函数: 更新 TODO.md 中的任务状态
update_todo_status() {
    local task_name="$1"
    local new_status="$2"  # "✅ 完成" 或 "⬜ 待开发"

    # 提取任务名（去掉描述和路径部分）
    local clean_name=$(echo "$task_name" | cut -d':' -f1 | xargs)

    if [ -z "$clean_name" ]; then
        log_warning "无法解析任务名"
        return 1
    fi

    # 使用 sed 替换任务状态
    # 查找包含任务名和 "⬜ 待开发" 的行，替换为新状态
    if [ "$new_status" = "✅ 完成" ]; then
        sed -i.bak "/$clean_name/s/⬜ 待开发/✅ 完成/g" "$TODO_FILE"
    else
        sed -i.bak "/$clean_name/s/✅ 完成/⬜ 待开发/g" "$TODO_FILE"
    fi

    rm -f "$TODO_FILE.bak"
    log_info "已更新任务状态: $clean_name -> $new_status"
}

# 函数: 运行测试
run_tests() {
    log_info "运行测试..."

    # 检查是否有 package.json
    if [ ! -f "package.json" ]; then
        log_warning "package.json 不存在，跳过测试"
        return 0
    fi

    # 检查是否配置了测试脚本
    if ! grep -q '"test"' package.json; then
        log_warning "测试脚本未配置，跳过测试"
        return 0
    fi

    # 运行测试
    if pnpm test > "$TEST_LOG" 2>&1; then
        log_success "测试通过"
        return 0
    else
        log_error "测试失败，查看日志: $TEST_LOG"
        return 1
    fi
}

# 函数: 初始化状态文件
init_state_file() {
    if [ ! -f "$STATE_FILE" ]; then
        cat > "$STATE_FILE" << 'EOF'
# ServerPilot 开发状态记录

> 此文件自动记录开发进度和状态变更

---

## 开发日志

EOF
    fi
}

# 函数: 更新状态文件
update_state() {
    local task="$1"
    local status="$2"

    init_state_file

    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # 在 STATE.md 中追加记录
    cat >> "$STATE_FILE" << EOF

### [$timestamp] $status

**任务**: $task

EOF

    if [ "$status" = "✅ 完成" ]; then
        cat >> "$STATE_FILE" << EOF
**状态**: 开发完成，测试通过

EOF
    elif [ "$status" = "❌ 失败" ]; then
        cat >> "$STATE_FILE" << EOF
**状态**: 测试失败，需要修复

EOF
    fi
}

# 函数: 记录失败任务
record_failed_task() {
    local task="$1"
    local reason="$2"
    local attempts="$3"

    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # 创建失败日志文件（如果不存在）
    if [ ! -f "$FAILED_LOG" ]; then
        cat > "$FAILED_LOG" << 'EOF'
# ServerPilot 失败任务记录

此文件记录自动化开发过程中失败的任务。

## 说明

- **超时**: 任务执行超过60分钟
- **失败**: 任务执行失败或测试未通过
- **重试次数**: 每个任务最多尝试3次

---

EOF
    fi

    # 追加失败记录
    cat >> "$FAILED_LOG" << EOF
## [$timestamp] 任务失败

**任务**: $task
**原因**: $reason
**尝试次数**: $attempts 次
**状态**: ❌ 已跳过

---

EOF

    log_error "任务已记录到 $FAILED_LOG"
}

# 函数: 构建 Claude Prompt
build_prompt() {
    local task="$1"

    cat << EOF
你正在开发 ServerPilot 项目 - 一个 AI 驱动的智能运维平台。

## 项目信息
- 技术栈: Node.js 22+ / TypeScript / Hono / React / Drizzle ORM / SQLite
- 架构: Monorepo (packages/server, packages/agent, packages/dashboard, packages/shared)
- 文档位置: docs/

## 当前任务
$task

## 开发要求
1. 遵循 docs/开发标准.md 中的规范
2. 参考 docs/SERVERPILOT技术方案.md 中的架构设计
3. 实现功能并编写测试
4. 确保代码类型安全，使用 Zod 进行数据验证
5. **重要**: 不要修改 docs/TODO.md 的任务状态，系统会自动验证并更新

## 安全规则
- 不执行破坏性命令
- 不暴露敏感信息
- 遵循命令分级制度

开始执行任务。
EOF
}

# 函数: 使用 Claude Code 执行任务（带超时和重试）
execute_task_with_claude() {
    local task="$1"
    local iteration="$2"
    local max_attempts=3
    local timeout_seconds=3600  # 60分钟 = 3600秒

    log_task "第 $iteration 轮: $task"

    # 重试循环
    for attempt in $(seq 1 $max_attempts); do
        if [ $attempt -gt 1 ]; then
            log_warning "第 $attempt 次尝试..."
        fi

        # 构建 prompt
        local prompt=$(build_prompt "$task")

        log_info "调用 Claude Code (超时限制: 60分钟)..."
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        # 创建临时输出文件
        local output_file=$(mktemp)
        local pid_file=$(mktemp)

        # 在后台运行 Claude Code
        (
            echo "$prompt" | claude -p "$prompt" > "$output_file" 2>&1
            echo $? > "$pid_file.exit"
        ) &
        local claude_pid=$!
        echo $claude_pid > "$pid_file"

        # 等待执行完成或超时
        local elapsed=0
        local check_interval=5
        while kill -0 $claude_pid 2>/dev/null; do
            sleep $check_interval
            elapsed=$((elapsed + check_interval))

            # 显示进度
            if [ $((elapsed % 60)) -eq 0 ]; then
                log_info "已运行 $((elapsed / 60)) 分钟..."
            fi

            # 检查是否超时
            if [ $elapsed -ge $timeout_seconds ]; then
                log_error "任务超时 (60分钟)，强制终止..."

                # 强制终止 Claude 进程及其子进程
                pkill -TERM -P $claude_pid 2>/dev/null || true
                sleep 2
                pkill -KILL -P $claude_pid 2>/dev/null || true
                kill -9 $claude_pid 2>/dev/null || true

                # 清理
                rm -f "$output_file" "$pid_file" "$pid_file.exit"

                # 如果是最后一次尝试，记录失败
                if [ $attempt -eq $max_attempts ]; then
                    record_failed_task "$task" "执行超时 (60分钟)" "$attempt"
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                    echo ""
                    log_warning "跳过此任务，继续下一个..."
                    return 2  # 返回2表示超时
                fi

                # 等待后重试
                log_warning "等待30秒后重试..."
                sleep 30
                continue 2  # 继续外层循环（重试）
            fi
        done

        # 检查退出状态
        local exit_code=1
        if [ -f "$pid_file.exit" ]; then
            exit_code=$(cat "$pid_file.exit")
        fi

        # 显示输出
        if [ -f "$output_file" ]; then
            cat "$output_file"
        fi

        # 清理临时文件
        rm -f "$output_file" "$pid_file" "$pid_file.exit"

        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""

        # 检查是否成功
        if [ $exit_code -eq 0 ]; then
            log_success "Claude Code 执行完成"
            return 0
        else
            log_error "Claude Code 执行失败 (退出码: $exit_code)"

            # 如果是最后一次尝试，记录失败
            if [ $attempt -eq $max_attempts ]; then
                record_failed_task "$task" "执行失败，退出码: $exit_code" "$attempt"
                return 1
            fi

            # 等待后重试
            log_warning "等待30秒后重试..."
            sleep 30
        fi
    done

    # 所有尝试都失败
    return 1
}

# 函数: 验证任务完成
verify_task_completion() {
    local task="$1"

    log_info "验证任务完成..."

    # 运行测试验证
    if run_tests; then
        log_success "任务验证通过"
        update_state "$task" "✅ 完成"
        # 测试通过后才更新 TODO.md 状态
        update_todo_status "$task" "✅ 完成"
        return 0
    else
        log_error "任务验证失败"
        update_state "$task" "❌ 失败"
        # 测试失败，保持任务为待开发状态（不更新 TODO.md）
        return 1
    fi
}

# 函数: 显示进度
show_progress() {
    # 统计任务数量
    local pending=$(grep -c "⬜ 待开发" "$TODO_FILE" 2>/dev/null || echo "0")
    local completed=$(grep -c "✅ 完成" "$TODO_FILE" 2>/dev/null || echo "0")
    local in_progress=$(grep -c "🔄 进行中" "$TODO_FILE" 2>/dev/null || echo "0")

    # 确保是数字
    pending=${pending:-0}
    completed=${completed:-0}
    in_progress=${in_progress:-0}

    local total=$((pending + completed + in_progress))
    local percentage=0

    if [ $total -gt 0 ]; then
        percentage=$((completed * 100 / total))
    fi

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}📊 ServerPilot 项目进度${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ✅ 已完成: ${GREEN}$completed${NC}"
    echo -e "  🔄 进行中: ${BLUE}$in_progress${NC}"
    echo -e "  ⬜ 待完成: ${YELLOW}$pending${NC}"
    echo -e "  📈 进度: ${PURPLE}$percentage%${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# 主函数
main() {
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       ServerPilot 自动化开发系统启动                        ║${NC}"
    echo -e "${CYAN}║       AI 驱动的智能运维平台                                 ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 清空或创建日志文件
    > "$LOG_FILE"

    # 检查环境
    check_environment

    echo ""
    log_info "开始自动化开发流程..."
    log_info "任务清单: $TODO_FILE"
    log_info "按 Ctrl+C 可随时停止"
    echo ""

    # 显示初始进度
    show_progress

    # 计数器
    local iteration=0
    local max_iterations=100  # 防止无限循环

    # 主循环
    while [ $iteration -lt $max_iterations ]; do
        iteration=$((iteration + 1))

        # 检查是否还有任务
        if ! has_pending_tasks; then
            log_success "🎉 所有任务已完成！"
            show_progress
            break
        fi

        # 获取下一个任务
        local next_task=$(get_next_task)

        if [ -z "$next_task" ]; then
            log_success "没有更多待完成的任务"
            break
        fi

        # 执行任务
        local exec_result=0
        execute_task_with_claude "$next_task" "$iteration"
        exec_result=$?

        if [ $exec_result -ne 0 ]; then
            if [ $exec_result -eq 2 ]; then
                log_error "任务超时，已记录到 $FAILED_LOG"
            else
                log_error "任务执行失败，已记录到 $FAILED_LOG"
            fi
            log_warning "跳过此任务，30秒后继续下一个..."
            sleep 30

            # 显示进度后继续下一个任务
            show_progress
            if has_pending_tasks; then
                log_info "等待 10 秒后继续下一个任务..."
                sleep 10
            fi
            continue
        fi

        # 验证任务完成
        if ! verify_task_completion "$next_task"; then
            log_error "任务验证失败"
            log_warning "30秒后将继续下一个任务..."
            sleep 30
        fi

        # 显示进度
        show_progress

        # 等待一段时间再继续（避免 API 限流）
        if has_pending_tasks; then
            log_info "等待 10 秒后继续下一个任务..."
            sleep 10
        fi
    done

    if [ $iteration -ge $max_iterations ]; then
        log_warning "达到最大迭代次数 ($max_iterations)，停止执行"
    fi

    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║       自动化开发流程结束                                    ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    log_info "日志文件: $LOG_FILE"
    log_info "测试日志: $TEST_LOG"
    log_info "状态文件: $STATE_FILE"
}

# 信号处理 - 优雅退出
trap 'echo ""; log_warning "收到中断信号，正在退出..."; exit 130' INT TERM

# 运行主函数
main "$@"
