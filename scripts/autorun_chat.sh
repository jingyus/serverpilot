#!/bin/bash
#
# ServerPilot AI Chat 质量自循环改进脚本
#
# 聚焦领域:
# - 对话话题管理（会话分组、重命名、搜索）
# - 聊天记录持久化（当前仅内存存储，重启丢失）
# - AI 智能化（上下文管理、多轮对话质量、意图理解）
# - UI 展示效果（消息渲染、流式体验、响应式布局）
# - 系统稳定性（错误恢复、断连重连、边界处理）
#

# ============================================================================
# 模块配置
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODULE_NAME="Chat/AI 对话系统"
BRANCH_PREFIX="feat/chat-improve"
COMMIT_PREFIX="feat(chat)"
COMMIT_GENERATED="autorun_chat.sh (AI Chat Quality Improvement)"

LOG_FILE="$PROJECT_DIR/autorun_chat.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_CHAT_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_CHAT_TASK.md"
TASK_QUEUE="$PROJECT_DIR/CHAT_TASK_QUEUE.md"
TEST_LOG="$PROJECT_DIR/chat_test.log"
TOKEN_LOG="$PROJECT_DIR/CHAT_TOKEN_USAGE.log"

# ============================================================================
# 钩子: 模块专用环境检查
# ============================================================================

module_check_environment() {
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
# 钩子: 任务队列初始内容
# ============================================================================

module_init_queue_header() {
    cat << 'EOF'
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
}

# ============================================================================
# 钩子: 启动信息 & 进度额外行
# ============================================================================

module_banner_info() {
    log_info "聚焦领域: 话题管理 | 记录持久化 | 智能化 | UI体验 | 稳定性"
}

# ============================================================================
# 钩子: 模块测试
# ============================================================================

module_run_tests() {
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
# 钩子: Prompts
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

你的输出必须且只能是一个 \`\`\`tasks 代码块，不要输出任何其他内容。

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
- **必须引用具体代码**，不要泛泛而谈
- **任务粒度适中**，每个任务 1-2 小时可完成
- **不要重复已完成的任务**，先检查 CHAT_TASK_QUEUE.md 中已完成的任务
- **优先 P0 问题**，只有当 P0 问题都解决后才生成 P1/P2/P3
- 遵守 docs/AI开发约束.md 中的代码规范
- 单文件不超过 500 行（硬限制 800 行）
- **⚠️ 单包原则（必须遵守）**: 每个任务只能修改**一个**包（server 或 dashboard 或 shared），禁止生成跨包任务
- **影响范围限制**: 每个任务最多修改 3-4 个文件
- **跨包功能必须拆分**: 如需跨包实现，必须拆成多个独立任务，按依赖顺序排列：先 shared → 再 server → 最后 dashboard。每个子任务独立可测试

直接输出 \`\`\`tasks 代码块，不要输出任何前言或分析:
PROMPT_EOF
}

build_execute_prompt() {
    local task_content="$1"

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
# 加载公共模块并运行
# ============================================================================

source "$SCRIPT_DIR/autorun-common.sh"
autorun_main "$@"
