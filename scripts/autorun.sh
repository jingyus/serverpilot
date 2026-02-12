#!/bin/bash
#
# ServerPilot AI 自循环开发脚本（通用版）
#
# 覆盖全项目模块，基于产品方案和 AI 开发约束自动推进开发。
#
# 必读文档:
# - docs/AI开发约束.md    — 版本分离规则、开发优先级
# - docs/产品方案-目录.md  — MVP 范围、技术栈概要
# - docs/开发标准.md       — 技术架构、代码规范
#

# ============================================================================
# 模块配置
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODULE_NAME="ServerPilot 全局开发"
BRANCH_PREFIX="feat/autorun-dev"
COMMIT_PREFIX="feat"
COMMIT_GENERATED="autorun.sh (AI-driven development)"

LOG_FILE="$PROJECT_DIR/autorun.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_TASK.md"
TASK_QUEUE="$PROJECT_DIR/TASK_QUEUE.md"
TEST_LOG="$PROJECT_DIR/test.log"
TOKEN_LOG="$PROJECT_DIR/TOKEN_USAGE.log"

# 文档路径
PRODUCT_GUIDE="$PROJECT_DIR/docs/产品方案-目录.md"
PRODUCT_DOC="$PROJECT_DIR/docs/DevOps产品方案.md"
DEV_STANDARD="$PROJECT_DIR/docs/开发标准.md"
AI_CONSTRAINTS="$PROJECT_DIR/docs/AI开发约束.md"

# ============================================================================
# 钩子: 模块专用环境检查
# ============================================================================

module_check_environment() {
    if [ ! -f "$PRODUCT_GUIDE" ]; then
        log_error "产品方案目录不存在: $PRODUCT_GUIDE"
        exit 1
    fi
    log_success "产品方案目录: $PRODUCT_GUIDE"

    if [ -f "$PRODUCT_DOC" ]; then
        log_success "完整产品方案: $PRODUCT_DOC"
    else
        log_warning "完整产品方案不存在: $PRODUCT_DOC"
    fi

    if [ -f "$DEV_STANDARD" ]; then
        log_success "开发标准文档: $DEV_STANDARD"
    else
        log_warning "开发标准文档不存在: $DEV_STANDARD"
    fi

    if [ ! -f "$AI_CONSTRAINTS" ]; then
        log_error "AI 开发约束文档不存在: $AI_CONSTRAINTS"
        exit 1
    fi
    log_success "AI 开发约束: $AI_CONSTRAINTS"
}

# ============================================================================
# 钩子: 任务队列初始内容
# ============================================================================

module_init_queue_header() {
    cat << 'EOF'
# ServerPilot 全局开发任务队列

> AI 自动分析项目状态 → 生成任务 → 实现 → 验证

**最后更新**: -

## 📊 统计

- **总任务数**: 0
- **待完成** (pending): 0
- **进行中** (in_progress): 0
- **已完成** (completed): 0
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动在此添加任务)

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`
EOF
}

# ============================================================================
# 钩子: 启动信息
# ============================================================================

module_banner_info() {
    log_info "产品方案: $PRODUCT_GUIDE"
    log_info "开发标准: $DEV_STANDARD"
}

module_help_extra() {
    echo ""
    echo "必读文档:"
    echo "  AI_CONSTRAINTS=$AI_CONSTRAINTS"
}

# ============================================================================
# 钩子: 模块测试 — 全项目增量测试
# ============================================================================

module_run_tests() {
    log_info "运行增量测试（智能检测变更模块）..."

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
    local test_agent=false
    local test_dashboard=false
    local test_shared=false

    while IFS= read -r file; do
        if echo "$file" | grep -q "^packages/server/"; then
            test_server=true
        elif echo "$file" | grep -q "^packages/agent/"; then
            test_agent=true
        elif echo "$file" | grep -q "^packages/dashboard/"; then
            test_dashboard=true
        elif echo "$file" | grep -q "^packages/shared/"; then
            test_shared=true
        fi
    done <<< "$changed_files"

    if [ "$test_shared" = true ]; then
        log_warning "shared 模块变更，运行全量测试"
        pnpm test > "$TEST_LOG" 2>&1
        return $?
    fi

    local test_failed=false

    if [ "$test_server" = true ]; then
        log_info "测试 server 模块..."
        if run_module_test "server" "$TEST_LOG"; then
            log_success "server 模块测试通过"
        else
            log_error "server 模块测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_agent" = true ]; then
        log_info "测试 agent 模块..."
        if run_module_test "agent" "$TEST_LOG" "true"; then
            log_success "agent 模块测试通过"
        else
            log_error "agent 模块测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_dashboard" = true ]; then
        log_info "测试 dashboard 模块..."
        if run_module_test "dashboard" "$TEST_LOG" "true"; then
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

# ============================================================================
# 钩子: Prompts
# ============================================================================

build_discover_prompt() {
    cat << 'PROMPT_EOF'
你是 ServerPilot 项目的 AI 开发助手。请分析项目当前状态，**批量生成**接下来要完成的任务。

## 必读文档

> **⚠️ 强制约束**: 在生成任务前，必须先阅读 `docs/AI开发约束.md`，严格遵守版本分离原则和开发优先级。

**AI 开发约束**: docs/AI开发约束.md - **必读** — 版本分离规则、开发优先级、暂缓功能列表
**产品方案**: docs/产品方案-目录.md - MVP 范围、优先级、技术栈概要
**完整方案**: docs/DevOps产品方案.md - 详细产品设计（需要时查阅）
**开发标准**: docs/开发标准.md - 技术架构、代码规范、Git 工作流、测试标准

## 你的任务

1. **阅读 AI 开发约束**: 先读 docs/AI开发约束.md，了解版本分离规则和暂缓开发的功能列表
2. **阅读产品方案目录**: 读 docs/产品方案-目录.md，了解 MVP 范围和开发优先级
3. **遵循开发标准**: 查看 docs/开发标准.md，了解技术架构和代码规范
4. **分析当前代码**: 检查 packages/ 目录下各模块的实现状态
5. **批量生成任务**: 根据 AI 开发约束中的优先级生成 5-10 个待完成任务（按重要性排序）

## 输出格式 (严格！！！)

你的输出必须且只能是一个 \`\`\`tasks 代码块，不要输出任何其他内容。

\`\`\`tasks
### [pending] 任务1标题

**ID**: task-001
**优先级**: P0
**模块路径**: packages/server/src/core/
**任务描述**: 详细说明要实现什么功能
**产品需求**: 对应产品方案中的哪个功能点
**验收标准**: 如何验证任务完成
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] 任务2标题
...
\`\`\`

## 注意事项

- **版本分离**: 不得生成云版专属任务（PostgreSQL适配、Stripe计费等）
- **任务粒度**: 每个任务 1-2 小时可完成
- **优先级**: P0 开源核心 > P1 开源发布 > P2 开源增值
- **依赖关系**: 考虑任务之间的依赖，先生成基础任务
- **可执行性**: 每个任务描述要清晰、可独立执行
- **代码隔离**: 任务涉及的模块路径必须符合 AI开发约束.md 中的架构边界
- 单文件不超过 500 行（硬限制 800 行）

直接输出 \`\`\`tasks 代码块，不要输出任何前言或分析:
PROMPT_EOF
}

build_execute_prompt() {
    local task_content="$1"

    cat << EOF
你正在开发 ServerPilot 项目 — AI 驱动的智能运维平台。

## 项目信息
- Monorepo: packages/server(Hono+Drizzle+SQLite), dashboard(React+Vite+Zustand), shared(Zod), agent
- 包名: @aiinstaller/* | Node 22+ | TypeScript strict | ESM (.js 后缀)
- 详细规范见: docs/AI开发约束.md, docs/开发标准.md

## 当前任务
$task_content

## 开发约束
- TypeScript strict, 无 any, Zod 验证外部输入
- 单文件 ≤ 500 行 (硬限制 800)
- 单例模式: getXxx() / setXxx() / _resetXxx()
- 仓库模式: interface + Drizzle + InMemory 实现
- API 路由: requireAuth → resolveRole → requirePermission 中间件链
- 测试: 安全 ≥95%, AI ≥90%, 整体 ≥80%
- 云版功能 (PostgreSQL/Stripe) 不得混入开源核心

开始执行任务。完成后运行测试确保功能正常。
EOF
}

build_fix_prompt() {
    local test_output="$1"

    cat << EOF
测试运行失败，请分析错误并修复。

## 测试输出
$test_output

## 修复要求

1. 分析测试失败的原因
2. 定位问题代码
3. 修复代码而不是修改测试期望值（除非测试本身有误）
4. 确保修复后测试通过

## 注意事项
- 不要删除或跳过测试
- 确保修复不会引入新的问题
- 遵守 docs/AI开发约束.md 中的代码隔离和架构边界规则

开始修复...
EOF
}

# ============================================================================
# 加载公共模块并运行
# ============================================================================

source "$SCRIPT_DIR/autorun-common.sh"
autorun_main "$@"
