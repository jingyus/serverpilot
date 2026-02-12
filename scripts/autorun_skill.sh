#!/bin/bash
#
# ServerPilot Skill 插件系统开发自循环脚本
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

# ============================================================================
# 模块配置
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODULE_NAME="Skill 插件系统"
BRANCH_PREFIX="feat/skill-engine"
COMMIT_PREFIX="feat(skill)"
COMMIT_GENERATED="autorun_skill.sh (Skill Engine Development)"

LOG_FILE="$PROJECT_DIR/autorun_skill.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_SKILL_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_SKILL_TASK.md"
TASK_QUEUE="$PROJECT_DIR/SKILL_TASK_QUEUE.md"
TEST_LOG="$PROJECT_DIR/skill_test.log"
TOKEN_LOG="$PROJECT_DIR/SKILL_TOKEN_USAGE.log"

# 标准文档路径（只读引用）
SKILL_SPEC="$PROJECT_DIR/skills/SKILL_SPEC.md"
SKILL_SCHEMA="$PROJECT_DIR/packages/shared/src/skill-schema.ts"
SKILL_EXAMPLES="$PROJECT_DIR/skills/official"
DEV_CONTEXT="$SCRIPT_DIR/SKILL_DEV_CONTEXT.md"

# ============================================================================
# 钩子: 模块专用环境检查
# ============================================================================

module_check_environment() {
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
# 钩子: 任务队列初始内容
# ============================================================================

module_init_queue_header() {
    cat << 'EOF'
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
}

# ============================================================================
# 钩子: 启动信息 & 进度额外行
# ============================================================================

module_banner_info() {
    log_info "开发范围: SkillEngine | TriggerManager | API | Dashboard | Store"
    log_info "标准文档: skills/SKILL_SPEC.md"
}

module_progress_extra() {
    echo -e "  规范: skills/SKILL_SPEC.md"
}

module_help_extra() {
    echo ""
    echo "标准文档:"
    echo "  skills/SKILL_SPEC.md           Skill 规范定义"
    echo "  shared/src/skill-schema.ts     Zod 验证 Schema"
    echo "  scripts/SKILL_DEV_CONTEXT.md   开发上下文"
}

# ============================================================================
# 钩子: 模块测试
# ============================================================================

module_run_tests() {
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
        if run_module_test "server" "$TEST_LOG"; then
            log_success "server 测试通过"
        else
            log_error "server 测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_dashboard" = true ]; then
        log_info "测试 dashboard 模块 (Skill UI)..."
        if run_module_test "dashboard" "$TEST_LOG" "true"; then
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
# 钩子: Prompts
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
- **SkillRunner**: 将 Skill prompt 注入 AI，调用 tools
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

## 输出格式 (严格！！！)

你的输出必须且只能是一个 \`\`\`tasks 代码块，不要输出任何其他内容。

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
...
\`\`\`

## 重要约束

- **输出格式**: 只输出 \`\`\`tasks 代码块
- **只关注 Skill 模块**，不要修改 chat、webhook、task 等其他模块的现有代码
- **遵循现有模式**: 单例模式、仓库模式、中间件链
- **低耦合**: Skill 模块通过 getter 函数访问其他服务
- **先 P0 后 P1**: 只有当所有 P0 任务完成后才生成 P1 任务
- **任务粒度**: 每个任务 1-2 小时可完成
- **不要重复已完成任务**: 先检查 SKILL_TASK_QUEUE.md
- 单文件不超过 500 行（硬限制 800 行）

直接输出 \`\`\`tasks 代码块，不要输出任何前言或分析:
PROMPT_EOF
}

build_execute_prompt() {
    local task_content="$1"

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

## 当前任务

$task_content

## 约束

- **低耦合**: 通过 getter 函数访问其他服务
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
# 加载公共模块并运行
# ============================================================================

source "$SCRIPT_DIR/autorun-common.sh"
autorun_main "$@"
