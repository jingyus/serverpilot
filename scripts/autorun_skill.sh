#!/bin/bash
#
# ServerPilot Skill 插件系统开发自循环脚本
# AI 自主发现问题 -> 设计实现 -> 编码 -> 测试 -> 循环
#
# 用法: ./autorun_skill.sh [选项]
#
# 工作流程:
# 1. AI 扫描 Skill 模块代码，发现缺失功能和改进空间
# 2. AI 按优先级生成 Skill 模块开发任务
# 3. AI 自动实现
# 4. 运行测试验证
# 5. Git 提交 -> 继续下一轮
#
# 核心标准文档:
# - skills/SKILL_SPEC.md         — Skill 规范定义
# - shared/src/skill-schema.ts   — Zod 验证 Schema
# - skills/official/             — 官方 Skill 示例
#
# 开发范围 (低耦合，独立模块):
# - Server: core/skill/          — SkillEngine 引擎
# - Server: api/routes/skills.ts — REST API
# - Server: db/ (skill tables)   — 数据持久化
# - Dashboard: pages/Skills.tsx  — 管理界面
# - Shared: skill-schema.ts      — 已完成的验证层
#

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# 项目目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ============================================================================
# Skill 模块专用路径 — 与其他 autorun 脚本完全隔离
# ============================================================================

LOG_FILE="$PROJECT_DIR/autorun_skill.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_SKILL_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_SKILL_TASK.md"
TASK_QUEUE="$PROJECT_DIR/SKILL_TASK_QUEUE.md"
TEST_LOG="$PROJECT_DIR/skill_test.log"

# 标准文档路径（只读引用，不修改）
SKILL_SPEC="$PROJECT_DIR/skills/SKILL_SPEC.md"
SKILL_SCHEMA="$PROJECT_DIR/packages/shared/src/skill-schema.ts"
SKILL_EXAMPLES="$PROJECT_DIR/skills/official"
DEV_CONTEXT="$SCRIPT_DIR/SKILL_DEV_CONTEXT.md"

# 配置
INTERVAL=30
MAX_ITERATIONS=1000
ANALYZE_TIMEOUT=3600
EXECUTE_TIMEOUT=3600
NO_OUTPUT_TIMEOUT=3600
STUCK_CHECK_AFTER=1200
STUCK_CONFIRM_TIME=300
MAX_RETRIES=3
MAX_TASK_FAILURES=3
BATCH_SIZE=5

# Token 使用统计
TOTAL_TOKENS=0
MAX_TOKENS=10000000
COST_PER_1K_INPUT_TOKENS=0.003
COST_PER_1K_OUTPUT_TOKENS=0.015
TOKEN_LOG="$PROJECT_DIR/SKILL_TOKEN_USAGE.log"

# 通知
ENABLE_NOTIFICATION=true
NOTIFICATION_SCRIPT="$SCRIPT_DIR/send-notification.py"

# 加载共享任务队列函数
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

    if [ $TOTAL_TOKENS -gt $MAX_TOKENS ]; then
        log_error "已达到 Token 限制 ($MAX_TOKENS)，停止执行"
        exit 1
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
        memory)
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
# 环境检查 — Skill 模块专用
# ============================================================================

check_environment() {
    log_info "检查 Skill 开发环境..."

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

    # 验证 Skill 标准文档
    if [ -f "$SKILL_SPEC" ]; then
        log_success "Skill 规范: $SKILL_SPEC"
    else
        log_error "Skill 规范文档缺失: $SKILL_SPEC"
        exit 1
    fi

    if [ -f "$SKILL_SCHEMA" ]; then
        log_success "Skill Schema: $SKILL_SCHEMA"
    else
        log_error "Skill Schema 缺失: $SKILL_SCHEMA"
        exit 1
    fi

    if [ -d "$SKILL_EXAMPLES" ]; then
        local example_count=$(find "$SKILL_EXAMPLES" -name "skill.yaml" | wc -l | tr -d ' ')
        log_success "官方 Skill 示例: $example_count 个"
    fi

    # 检查 Skill 模块目录是否已创建
    local skill_dirs=(
        "packages/server/src/core/skill"
        "packages/server/src/api/routes"
        "packages/server/src/db/repositories"
    )
    for d in "${skill_dirs[@]}"; do
        if [ -d "$PROJECT_DIR/$d" ]; then
            log_success "目录就绪: $d"
        else
            log_info "目录待创建: $d (AI 将自动创建)"
        fi
    done
}

# ============================================================================
# 初始化 Skill 任务队列
# ============================================================================

init_skill_task_queue() {
    if [ -f "$TASK_QUEUE" ]; then
        return 0
    fi

    cat > "$TASK_QUEUE" << 'EOF'
# Skill 插件系统开发任务队列

> 此队列专注于 Skill 插件系统的设计与实现
> AI 自动扫描 → 发现缺失 → 设计实现 → 验证

**最后更新**: -

## 📊 统计

- **总任务数**: 0
- **待完成** (pending): 0
- **进行中** (in_progress): 0
- **已完成** (completed): 0
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动在此添加 Skill 模块开发任务)

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`
EOF
    log_success "初始化 Skill 任务队列: $TASK_QUEUE"
}

# ============================================================================
# 状态记录
# ============================================================================

init_state_file() {
    if [ ! -f "$STATE_FILE" ]; then
        cat > "$STATE_FILE" << 'EOF'
# Skill 插件系统开发日志

> AI 自动设计与实现 Skill 系统的记录

---

## 开发日志

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
# 核心 Prompt — AI 自主发现问题并生成 Skill 模块开发任务
# ============================================================================

build_discover_prompt() {
    # 加载开发上下文文档
    local dev_context=""
    if [ -f "$DEV_CONTEXT" ]; then
        dev_context=$(cat "$DEV_CONTEXT")
    fi

    cat << PROMPT_EOF
你是 ServerPilot 项目的 Skill 插件系统架构师。你的任务是**扫描当前 Skill 模块的开发状态**，发现缺失的功能，并生成下一批开发任务。

## 开发标准文档

以下是 Skill 系统的标准规范，所有开发必须严格遵循:

$dev_context

## 你的职责

你不是在执行别人给你的任务，而是**自主发现 Skill 模块的缺失和问题**。对照标准文档，找出还没实现的功能，按优先级生成任务。

## 必须扫描的文件

### Skill 模块核心 (如果目录/文件不存在，说明是待开发项)
1. \`packages/server/src/core/skill/\`     — SkillEngine 引擎目录
2. \`packages/server/src/api/routes/skills.ts\` — Skill REST API
3. \`packages/server/src/db/repositories/skill-repository.ts\` — 数据持久化
4. \`packages/server/src/db/schema.ts\`    — 检查是否有 skills 相关表

### 已完成的基础设施 (只读参考，不要修改)
5. \`packages/shared/src/skill-schema.ts\` — Zod 验证 Schema (已完成)
6. \`skills/SKILL_SPEC.md\`                — Skill 规范文档 (已完成)
7. \`skills/official/\`                     — 3 个官方 Skill 示例 (已完成)

### Dashboard Skill 页面 (如果不存在则待开发)
8. \`packages/dashboard/src/pages/Skills.tsx\`   — Skill 管理页面
9. \`packages/dashboard/src/stores/skills.ts\`   — Skill 状态管理
10. \`packages/dashboard/src/types/skill.ts\`    — 前端类型定义

### 参考的现有模式 (学习模式，不要修改)
11. \`packages/server/src/core/task/executor.ts\`     — 单例模式参考
12. \`packages/server/src/core/webhook/dispatcher.ts\` — 后台服务参考
13. \`packages/server/src/ai/agentic-chat.ts\`         — AI 自主循环参考
14. \`packages/server/src/index.ts\`                    — 服务注册参考

## 开发维度 (按优先级排序)

### P0 — 引擎核心 (必须先完成)
- **SkillEngine**: \`core/skill/engine.ts\` — 单例服务，Skill 加载/验证/执行
- **SkillLoader**: \`core/skill/loader.ts\` — YAML 解析、skill-schema.ts 验证
- **DB Schema**: skills 表 + skill_executions 表 + skill_store 表
- **SkillRepository**: CRUD + 状态管理
- **手动执行**: 基本的 manual trigger 执行流程

### P1 — AI 执行层
- **SkillRunner**: 将 Skill prompt 注入 AI，调用 tools (shell/read_file/notify)
- **安全集成**: classifyCommand() 风险检查 + risk_level_max 约束
- **审计集成**: 所有命令记录到 audit_log
- **超时 & 步数限制**: constraints.timeout + constraints.max_steps

### P2 — 触发系统
- **TriggerManager**: \`core/skill/trigger-manager.ts\` — 统一触发调度
- **Cron 触发**: 使用 node-cron 或类似库
- **Event 触发**: 监听 WebhookDispatcher 事件
- **Threshold 触发**: 监听 MetricsBus 阈值

### P3 — API & Dashboard
- **REST API**: \`api/routes/skills.ts\` — CRUD + execute + logs
- **RBAC**: skill:manage + skill:execute 权限
- **Dashboard 页面**: Skill 列表 / 详情 / 配置 / 执行日志
- **SSE 推送**: Skill 执行实时进度流

### P4 — 高级功能
- **Skill Store**: 每个 Skill 的 KV 持久化存储
- **社区安装**: 从 Git URL 安装 Skill
- **Skill 间链式触发**: skill.completed 事件触发下游 Skill
- **执行历史 & 报告**: Dashboard 展示历史执行结果

## 发现问题的方法

1. **检查文件是否存在**: 对照上述文件列表，不存在的就是待开发
2. **检查已有代码的完整度**: 已有文件是否实现了所有标准定义的功能
3. **检查集成点**: SkillEngine 是否正确注册到 index.ts 启动流程
4. **检查测试覆盖**: 每个模块是否有对应的测试文件
5. **对照 SKILL_SPEC.md**: 规范中定义的每个功能是否都已实现

## 输出格式 (严格！！！)

你的输出必须且只能是一个 \`\`\`tasks 代码块，不要输出任何其他内容（不要表格、不要分析报告、不要总览）。
脚本会自动解析这个代码块，任何格式偏差都会导致解析失败。

**你的完整输出必须是:**

\`\`\`tasks
### [pending] 第一个任务的标题

**ID**: skill-XXX
**优先级**: P0
**模块路径**: packages/xxx/src/xxx/
**当前状态**: 文件不存在 / 功能缺失 / 需要改进
**实现方案**: 详细说明要创建什么文件、实现什么功能
**验收标准**: 完成后应达到什么效果
**影响范围**: 涉及哪些文件
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] 第二个任务的标题

**ID**: skill-XXX
**优先级**: P0
**模块路径**: packages/xxx/src/xxx/
**当前状态**: ...
**实现方案**: ...
**验收标准**: ...
**影响范围**: ...
**创建时间**: (自动填充)
**完成时间**: -
\`\`\`

## 重要约束

- **输出格式**: 只输出 \`\`\`tasks 代码块，不要输出表格、分析报告或其他内容
- **只关注 Skill 模块**，不要修改 chat、webhook、task 等其他模块的现有代码
- **遵循现有模式**: 单例模式、仓库模式、中间件链 — 参考已有代码
- **低耦合**: Skill 模块通过 getter 函数访问其他服务，不要直接 import 实例
- **先 P0 后 P1**: 只有当所有 P0 任务完成后才生成 P1 任务
- **任务粒度**: 每个任务 1-2 小时可完成
- **不要重复已完成任务**: 先检查 SKILL_TASK_QUEUE.md
- 单文件不超过 500 行（硬限制 800 行）

直接输出 \`\`\`tasks 代码块，不要输出任何前言或分析:
PROMPT_EOF
}

# ============================================================================
# 核心 Prompt — 执行具体 Skill 开发任务
# ============================================================================

build_execute_prompt() {
    local task_content="$1"

    # 注意: 不注入完整的 SKILL_DEV_CONTEXT.md (10K chars)
    # execute prompt 只需要代码模式参考和约束，不需要完整架构蓝图
    # 完整上下文只在 discover prompt 中使用

    cat << EOF
你是 ServerPilot 项目的 Skill 插件系统开发工程师，正在实现一个具体的开发任务。

## 项目信息

- **Monorepo**: pnpm workspaces, 包名 @aiinstaller/* (server, agent, shared, dashboard)
- **Server**: Hono + better-sqlite3 + Drizzle ORM + TypeScript strict + NodeNext
- **Dashboard**: React 18 + Vite 5 + Zustand 5 + Tailwind CSS 3
- **Shared**: Zod schemas (单一真相源), skill-schema.ts 已定义 SkillManifestSchema
- **测试**: Vitest (server=node 环境, dashboard=jsdom 环境)
- **ESM**: 所有 import 使用 \`.js\` 后缀

## 必须遵循的代码模式

### 单例模式 (所有 core 服务)
\`\`\`typescript
let _instance: ClassName | null = null;
export function getClassName(deps?): ClassName { ... }
export function setClassName(inst: ClassName): void { _instance = inst; }
export function _resetClassName(): void { _instance = null; }
\`\`\`

### 仓库模式 (数据访问层)
- 定义 interface → DrizzleXxxRepository 实现 → InMemoryXxxRepository (测试) → 单例 getter

### API 路由模式 (Hono)
- 中间件链: \`requireAuth → resolveRole → requirePermission('skill:xxx')\`
- 请求体用 Zod 验证

### 日志
- \`import { createContextLogger } from '../../utils/logger.js';\`

## 当前任务

$task_content

## 约束

- **低耦合**: 通过 getter 函数访问其他服务 (getTaskExecutor, getWebhookDispatcher 等)
- **TypeScript strict**: 不允许 any，使用 Zod 验证外部输入
- **单文件不超过 500 行** (硬限制 800 行)
- **只修改 Skill 相关文件**，不要动 chat/webhook/task 等现有模块
- **编写测试**: 为新增代码编写 Vitest 测试
- **参考文档**: 详细架构见 \`skills/SKILL_SPEC.md\` 和 \`scripts/SKILL_DEV_CONTEXT.md\`

完成后运行测试:
- Server: \`pnpm --filter @aiinstaller/server test\`
- Dashboard: \`pnpm --filter @aiinstaller/dashboard test\`
- Shared 变更: \`pnpm --filter @aiinstaller/shared build\`

开始实现...
EOF
}

# ============================================================================
# 核心 Prompt — 修复测试失败
# ============================================================================

build_fix_prompt() {
    local test_output="$1"

    cat << EOF
Skill 模块开发后测试失败，请分析并修复。

## 测试输出
$test_output

## 修复要求

1. 分析测试失败的原因
2. 定位问题代码（在最近的 Skill 模块改动中）
3. 修复代码而不是削弱测试
4. 确保修复不破坏其他模块的测试

## 注意

- Dashboard 测试在 \`packages/dashboard/\` 下运行 (jsdom 环境)
- Server 测试在根目录运行 (node 环境)
- Shared 需要 build: \`pnpm --filter @aiinstaller/shared build\`
- 不要删除或跳过测试
- 只修改 Skill 相关文件，不要动其他模块

开始修复...
EOF
}

# ============================================================================
# 批量生成任务
# ============================================================================

run_claude_batch_generate() {
    local prompt=$(build_discover_prompt)
    local output_file=$(mktemp)

    log_ai "AI 正在扫描 Skill 模块开发状态..."

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
            log_token_usage $input_tokens $output_tokens "Skill 模块扫描"

            local stats=$(get_task_stats "$TASK_QUEUE")
            read total pending in_progress completed failed <<< "$stats"
            log_success "发现 $pending 个开发任务"
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
        log_error "AI Skill 模块扫描失败"
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

    log_info "任务队列为空，AI 开始新一轮 Skill 模块扫描..."
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

    log_ai "AI 正在实现 Skill 开发任务... (超时: $((EXECUTE_TIMEOUT/60))分钟)"
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
        log_token_usage $input_tokens $output_tokens "Skill 开发执行"
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
# 增量测试 — 只测试 Skill 相关模块
# ============================================================================

run_skill_tests() {
    log_info "运行 Skill 相关测试..."

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

    # shared 变更需要先 build 再测全量
    if [ "$test_shared" = true ]; then
        log_info "shared 模块变更，先 build..."
        if ! pnpm --filter @aiinstaller/shared build > "$TEST_LOG" 2>&1; then
            log_error "shared build 失败"
            tail -20 "$TEST_LOG"
            return 1
        fi
        log_warning "shared 变更影响全部，运行全量测试"
        pnpm test >> "$TEST_LOG" 2>&1
        return $?
    fi

    local test_failed=false

    if [ "$test_server" = true ]; then
        log_info "测试 server 模块 (Skill 相关)..."
        if pnpm --filter @aiinstaller/server test > "$TEST_LOG" 2>&1; then
            log_success "server 测试通过"
        else
            log_error "server 测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_dashboard" = true ]; then
        log_info "测试 dashboard 模块 (Skill UI)..."
        if pnpm --filter @aiinstaller/dashboard test >> "$TEST_LOG" 2>&1; then
            log_success "dashboard 测试通过"
        else
            log_error "dashboard 测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_failed" = true ]; then
        log_error "Skill 相关测试失败"
        tail -50 "$TEST_LOG"
        return 1
    else
        log_success "Skill 相关测试全部通过"
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

    log_ai "AI 正在修复 Skill 测试失败..."

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

    local has_changes=false
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]; then
        has_changes=true
        git stash push --include-untracked -m "autorun_skill checkpoint $(date '+%Y%m%d_%H%M%S')" > /dev/null 2>&1
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
        local branch_name="feat/skill-engine-${branch_date}"

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

        local commit_msg="feat(skill): ${task_name}

Generated-By: autorun_skill.sh (Skill Engine Development)
Task-File: CURRENT_SKILL_TASK.md
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
    echo -e "${CYAN}Skill 插件系统开发${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  时间: ${BLUE}$current_time${NC}"
    echo -e "  轮次: ${PURPLE}$iteration${NC}"
    echo -e "  状态: $status"
    echo -e "  规范: skills/SKILL_SPEC.md"
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
                echo -e "${CYAN}Skill 开发任务统计${NC}"
                echo -e "  总计: $total | 待完成: $pending | 进行中: $in_progress | 已完成: $completed | 失败: $failed"
            else
                echo "尚未初始化任务队列"
            fi
            exit 0
            ;;
        --help|-h)
            echo "用法: $0 [选项]"
            echo ""
            echo "AI 自主设计与实现 Skill 插件系统"
            echo ""
            echo "选项:"
            echo "  --reset-failures  重置所有失败任务"
            echo "  --show-failures   显示失败任务统计"
            echo "  --status          显示任务队列状态"
            echo "  --help, -h        显示帮助"
            echo ""
            echo "标准文档:"
            echo "  skills/SKILL_SPEC.md           Skill 规范定义"
            echo "  shared/src/skill-schema.ts     Zod 验证 Schema"
            echo "  scripts/SKILL_DEV_CONTEXT.md   开发上下文"
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
    echo -e "${CYAN}║    Skill 插件系统开发自循环                                ║${NC}"
    echo -e "${CYAN}║    AI 扫描状态 -> 发现缺失 -> 设计实现 -> 测试 -> 循环     ║${NC}"
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
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Skill 插件系统开发会话开始" >> "$LOG_FILE"
    echo "═══════════════════════════════════════════════════════════════" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"

    check_environment
    init_skill_task_queue

    echo ""
    log_info "启动 Skill 插件系统开发..."
    log_info "开发范围: SkillEngine | TriggerManager | API | Dashboard | Store"
    log_info "标准文档: skills/SKILL_SPEC.md"
    log_info "循环间隔: ${INTERVAL}秒 | 单轮重试: ${MAX_RETRIES}次"
    log_info "按 Ctrl+C 可随时停止"
    echo ""

    local iteration=0

    while [ $iteration -lt $MAX_ITERATIONS ]; do
        iteration=$((iteration + 1))

        show_progress $iteration "${BLUE}检查 Skill 开发任务队列...${NC}"

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
        show_progress $iteration "${YELLOW}开发中: $task_name${NC}"

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
                if run_skill_tests; then
                    task_success=true
                    break
                else
                    log_warning "测试失败，AI 修复中..."
                    last_error_output=$(tail -100 "$TEST_LOG")
                    run_claude_fix

                    if run_skill_tests; then
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

            send_notification "Skill 开发完成: $task_name" \
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

            send_notification "Skill 开发失败(已回滚): $task_name" \
                "任务: $task_name\nID: $task_id\n失败: $error_msg\n代码已自动回滚" "error"
        fi

        log_info "等待 ${INTERVAL}秒 后继续下一轮..."
        sleep $INTERVAL
    done

    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║    Skill 插件系统开发结束                                  ║${NC}"
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
