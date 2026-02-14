#!/bin/bash
#
# ServerPilot 版本划分自动化脚本
#
# 聚焦领域:
# - 开源本地版（CE）与云端全功能版（EE）的功能划分
# - Feature Flag 系统建设
# - 后端路由保护与权限控制
# - 前端条件渲染与 UI 简化
# - 配置文件与文档更新
#

# ============================================================================
# 模块配置
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODULE_NAME="版本划分 (CE/EE Edition Split)"
BRANCH_PREFIX="feat/edition-split"
COMMIT_PREFIX="feat(edition)"
COMMIT_GENERATED="autorun_edition.sh (CE/EE Edition Split)"

LOG_FILE="$PROJECT_DIR/autorun_edition.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_EDITION_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_EDITION_TASK.md"
TASK_QUEUE="$PROJECT_DIR/EDITION_TASK_QUEUE.md"
TEST_LOG="$PROJECT_DIR/edition_test.log"
TOKEN_LOG="$PROJECT_DIR/EDITION_TOKEN_USAGE.log"

# ============================================================================
# 钩子: 模块专用环境检查
# ============================================================================

module_check_environment() {
    local edition_files=(
        "EDITION_MATRIX.md"
        "packages/server/src/index.ts"
        "packages/dashboard/src/App.tsx"
    )
    for f in "${edition_files[@]}"; do
        if [ -f "$PROJECT_DIR/$f" ]; then
            log_success "版本划分核心文件: $f"
        else
            log_warning "版本划分核心文件缺失: $f"
        fi
    done

    # 检查是否已有 CLOUD_MODE 环境变量
    if grep -q "CLOUD_MODE" "$PROJECT_DIR/packages/server/src/index.ts" 2>/dev/null; then
        log_success "CLOUD_MODE 环境变量已存在"
    else
        log_warning "CLOUD_MODE 环境变量未检测到"
    fi
}

# ============================================================================
# 钩子: 任务队列初始内容
# ============================================================================

module_init_queue_header() {
    cat << 'EOF'
# 版本划分 (CE/EE) 任务队列

> 将 ServerPilot 划分为开源本地版（CE）和云端全功能版（EE）
> 参考文档: EDITION_MATRIX.md

**最后更新**: -

## 📊 统计

- **总任务数**: 0
- **待完成** (pending): 0
- **进行中** (in_progress): 0
- **已完成** (completed): 0
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动在此添加版本划分任务)

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`

## 参考架构

### 后端 Feature Flag 系统
```typescript
// packages/server/src/config/edition.ts
export const EDITION = {
  isCE: process.env.EDITION === 'ce',
  isEE: process.env.EDITION === 'ee',
} as const;

export const FEATURES = {
  multiServer: EDITION.isEE,
  teamCollaboration: EDITION.isEE,
  webhooks: EDITION.isEE,
  // ...
} as const;
```

### 前端条件渲染
```typescript
// Dashboard
const { features } = useFeatures();

{features.multiServer && <NavItem to="/servers" />}
```

### 路由保护
```typescript
// Middleware
const requireFeature = (feature: keyof typeof FEATURES) => {
  return async (c: Context, next: Next) => {
    if (!FEATURES[feature]) {
      return c.json({ error: 'Feature not available in this edition' }, 403);
    }
    await next();
  };
};
```
EOF
}

# ============================================================================
# 钩子: 启动信息 & 进度额外行
# ============================================================================

module_banner_info() {
    log_info "聚焦领域: Feature Flag | 路由保护 | 条件渲染 | UI 简化 | 配置分离"
}

# ============================================================================
# 钩子: 模块测试
# ============================================================================

module_run_tests() {
    log_info "运行版本划分相关测试..."

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
        log_info "测试 server 模块 (Edition 相关)..."
        if run_module_test "server" "$TEST_LOG"; then
            log_success "server 测试通过"
        else
            log_error "server 测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_dashboard" = true ]; then
        log_info "测试 dashboard 模块 (Edition UI)..."
        if run_module_test "dashboard" "$TEST_LOG" "true"; then
            log_success "dashboard 测试通过"
        else
            log_error "dashboard 测试失败"
            test_failed=true
        fi
    fi

    if [ "$test_failed" = true ]; then
        log_error "版本划分相关测试失败"
        tail -50 "$TEST_LOG"
        return 1
    else
        log_success "版本划分相关测试全部通过"
        return 0
    fi
}

# ============================================================================
# 钩子: Prompts
# ============================================================================

build_discover_prompt() {
    cat << 'PROMPT_EOF'
你是 ServerPilot 项目的架构师，负责将项目划分为**开源本地版（CE）**和**云端全功能版（EE）**两个版本。

## 任务目标

将现有的 ServerPilot 代码库改造为支持两种版本模式：
1. **Community Edition (CE)** - 开源本地版，单机单用户，简化 UI
2. **Enterprise Edition (EE)** - 云端全功能版，多服务器多用户，企业功能

## 核心参考文档

**必读**: `EDITION_MATRIX.md` — 详细定义了 CE 和 EE 的功能矩阵

## 必须扫描的文件（按优先级）

### 阶段 1: Feature Flag 基础设施（优先！）
1. `packages/server/src/index.ts` — 服务器入口，检查是否有 CLOUD_MODE
2. 创建 `packages/server/src/config/edition.ts` — Edition 和 Features 配置
3. 创建 `packages/server/src/config/features.ts` — Feature Flag 定义
4. `packages/shared/src/rbac.ts` — 检查权限系统是否需要 Edition 感知

### 阶段 2: 后端 API 保护
5. 创建 `packages/server/src/api/middleware/require-feature.ts` — Feature 中间件
6. `packages/server/src/api/routes/index.ts` — 主路由，需要挂载 edition API
7. 创建 `packages/server/src/api/routes/system.ts` — 新增 /api/v1/system/edition 接口
8. `packages/server/src/api/routes/servers.ts` — 多服务器管理路由（EE only）
9. `packages/server/src/api/routes/team.ts` — 团队管理路由（EE only）
10. `packages/server/src/api/routes/webhooks.ts` — Webhook 路由（EE only）
11. `packages/server/src/api/routes/alerts.ts` — 告警路由（EE only）
12. `packages/server/src/api/routes/metrics.ts` — 实时指标路由（EE only）
13. `packages/server/src/api/routes/audit-log.ts` — 审计导出路由（EE only）

### 阶段 3: 前端 Feature 系统
14. 创建 `packages/dashboard/src/stores/system.ts` — System store，存储 edition 和 features
15. 创建 `packages/dashboard/src/hooks/useFeatures.ts` — useFeatures hook
16. `packages/dashboard/src/api/client.ts` — API 客户端，需要获取 edition 信息
17. `packages/dashboard/src/App.tsx` — 应用入口，CE 模式直接跳转到 /chat

### 阶段 4: UI 条件渲染
18. `packages/dashboard/src/components/layout/Sidebar.tsx` — 侧边栏导航，隐藏 EE 功能
19. `packages/dashboard/src/pages/Settings.tsx` — 设置页面，简化 CE 版选项
20. `packages/dashboard/src/router.tsx` (或 App.tsx 路由) — 路由配置，移除 EE 路由

### 阶段 5: 配置与文档
21. 创建 `.env.ce.example` — CE 版本环境变量示例
22. 创建 `.env.ee.example` — EE 版本环境变量示例
23. 创建 `docker-compose.ce.yml` — CE 版本 Docker Compose 配置
24. 创建 `docker-compose.ee.yml` — EE 版本 Docker Compose 配置
25. 更新 `README.md` — 添加版本对比表格和启动说明

## 功能划分（来自 EDITION_MATRIX.md）

### CE 版本包含的功能
- ✅ AI 对话（单个会话）
- ✅ 命令执行与审核
- ✅ 知识库 RAG
- ✅ 错误自动诊断
- ✅ 基础安全审计
- ✅ 用户个人设置
- ✅ 主题/语言切换

### EE 专属功能（需要 Feature Flag 保护）
- ❌ 多服务器管理 (`features.multiServer`)
- ❌ 团队协作 (`features.teamCollaboration`)
- ❌ Webhook (`features.webhooks`)
- ❌ 告警 (`features.alerts`)
- ❌ 实时指标监控 (`features.metricsMonitoring`)
- ❌ 审计导出 (`features.auditExport`)
- ❌ OAuth 登录 (`features.oauthLogin`)
- ❌ Rate Limiting (`features.rateLimiting`)
- ❌ 多租户 (`features.multiTenant`)

## 发现任务的方法

1. **阅读 EDITION_MATRIX.md**: 理解 CE 和 EE 的功能边界
2. **检查现有代码**: 哪些路由/组件属于 EE 专属功能？
3. **设计 Feature Flag**: 如何优雅地在代码中开关功能？
4. **追踪数据流**: 从 API → Store → UI，确保三层一致
5. **验证测试**: 现有测试是否需要适配两种模式？
6. **考虑兼容性**: CE → EE 升级路径是否平滑？

## 输出格式 (严格！！！)

你的输出必须且只能是一个 \`\`\`tasks 代码块，不要输出任何其他内容。

\`\`\`tasks
### [pending] 任务标题（简明描述改进内容）

**ID**: edition-XXX
**优先级**: P0/P1/P2/P3
**阶段**: 阶段1-基础设施 / 阶段2-后端保护 / 阶段3-前端系统 / 阶段4-UI简化 / 阶段5-配置文档
**模块路径**: packages/xxx/src/xxx/
**任务描述**: 详细说明需要做什么
**实现要点**:
  - 关键步骤1
  - 关键步骤2
**验收标准**: 改进完成后应该达到什么效果
**依赖任务**: edition-XXX (如果有依赖)
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] 另一个任务...
\`\`\`

## 重要约束

- **输出格式**: 只输出 \`\`\`tasks 代码块，不要输出表格、分析报告或其他内容
- **任务顺序**: 必须按阶段顺序（阶段1 → 阶段5），有依赖关系的任务标注 **依赖任务**
- **单包原则**: 每个任务只能修改**一个**包（server 或 dashboard 或 shared）
- **影响范围限制**: 每个任务最多修改 3-4 个文件
- **优先级**: P0 = 基础设施（必须先做），P1 = 功能保护，P2 = UI 优化，P3 = 文档配置
- **不要破坏现有功能**: EE 模式下所有现有功能必须正常工作
- **测试覆盖**: 每个阶段完成后必须有对应的测试
- **遵守代码规范**: 单文件不超过 500 行（硬限制 800 行）

直接输出 \`\`\`tasks 代码块，不要输出任何前言或分析:
PROMPT_EOF
}

build_execute_prompt() {
    local task_content="$1"

    cat << EOF
你是 ServerPilot 项目的架构师，正在执行版本划分（CE/EE Edition Split）的具体任务。

## 项目信息

- **Monorepo**: pnpm workspaces, 包名 @aiinstaller/* (server, agent, shared, dashboard)
- **Server**: Hono + better-sqlite3 + Drizzle ORM + TypeScript strict + NodeNext
- **Dashboard**: React 18 + Vite 5 + Zustand 5 + Tailwind CSS 3
- **测试**: Vitest (server=node 环境, dashboard=jsdom + @testing-library/react)
- **ESM**: 所有 import 使用 \`.js\` 后缀

## 版本划分目标

- **CE (Community Edition)**: 开源本地版，单机单用户，简化 UI
- **EE (Enterprise Edition)**: 云端全功能版，多服务器多用户，企业功能

## 当前任务

$task_content

## 开发约束

- **参考文档**: 严格遵守 EDITION_MATRIX.md 中的功能划分
- **Feature Flag**: 使用 \`FEATURES.featureName\` 检查功能可用性
- **向后兼容**: EE 模式下所有现有功能必须正常工作
- **TypeScript strict**: 不允许 any，使用 Zod 验证外部输入
- **单文件不超过 500 行** (硬限制 800 行)
- **编写测试**: 为新增/修改的代码编写测试（包括 CE 和 EE 两种模式）

## Feature Flag 示例

**后端**:
\`\`\`typescript
import { FEATURES } from '../config/features.js';

if (!FEATURES.multiServer) {
  return c.json({ error: 'Feature not available' }, 403);
}
\`\`\`

**前端**:
\`\`\`typescript
const { features } = useFeatures();

{features.multiServer && <NavItem to="/servers" />}
\`\`\`

完成后运行测试:
- 前端: \`pnpm --filter @aiinstaller/dashboard test\`
- 后端: \`pnpm --filter @aiinstaller/server test\`
- 全量: \`pnpm test\`

开始实现...
EOF
}

build_fix_prompt() {
    local test_output="$1"

    cat << EOF
版本划分改进后测试失败，请分析并修复。

## 测试输出
$test_output

## 修复要求

1. 分析测试失败的原因
2. 定位问题代码（一定在最近的改动中）
3. 修复代码而不是削弱测试
4. 确保修复不引入新问题
5. 验证 CE 和 EE 两种模式都能通过测试

## 关键注意

- Feature Flag 必须在后端验证，不能只在前端隐藏
- 测试需要覆盖 CE 和 EE 两种模式
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
