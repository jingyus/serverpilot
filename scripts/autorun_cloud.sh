#!/bin/bash
#
# ServerPilot Cloud 功能自动开发脚本
#
# 聚焦领域:
# - AI 配额管理（防止滥用，公平使用政策）
# - Stripe 计费集成（订阅管理，Webhook 处理）
# - 多租户架构（Tenant 隔离，权限控制）
# - 使用量仪表盘（AI 调用统计，成本趋势）
# - Agent 认证增强（订阅状态验证，限制检查）
# - Cloud Skills（日志巡检，安全扫描，性能优化）
#
# 设计原则:
# - P0 优先: AI 配额管理 → Stripe 计费 → Agent 认证增强
# - 数据库: PostgreSQL（Cloud 用 PG，Self-Hosted 用 SQLite）
# - 安全隔离: Row-Level Security，所有表 tenant_id 隔离
# - AI Agent 理念: 用户付费买 AI 智能，不是服务器托管

# ============================================================================
# 模块配置
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLOUD_DIR="$PROJECT_DIR/packages/cloud"

MODULE_NAME="Cloud (云服务)"
BRANCH_PREFIX="feat/cloud-develop"
COMMIT_PREFIX="feat(cloud)"
COMMIT_GENERATED="autorun_cloud.sh (Cloud Feature Development)"

LOG_FILE="$PROJECT_DIR/autorun_cloud.log"
STATE_FILE="$PROJECT_DIR/AUTORUN_CLOUD_STATE.md"
TASK_FILE="$PROJECT_DIR/CURRENT_CLOUD_TASK.md"
TASK_QUEUE="$PROJECT_DIR/CLOUD_TASK_QUEUE.md"
TEST_LOG="$PROJECT_DIR/cloud_test.log"
TOKEN_LOG="$PROJECT_DIR/CLOUD_TOKEN_USAGE.log"

# ============================================================================
# 钩子: 模块专用环境检查
# ============================================================================

module_check_environment() {
    # 检查 cloud 包是否存在
    if [ -d "$CLOUD_DIR" ]; then
        log_success "Cloud 包目录: $CLOUD_DIR"
    else
        log_warning "Cloud 包目录不存在，尝试创建..."
        mkdir -p "$CLOUD_DIR/src"

        # 创建基础 package.json
        cat > "$CLOUD_DIR/package.json" << 'EOF'
{
  "name": "@aiinstaller/cloud",
  "version": "1.0.0",
  "description": "ServerPilot Cloud Edition - Multi-tenant SaaS features",
  "type": "module",
  "license": "BUSL-1.1",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@aiinstaller/shared": "workspace:*",
    "drizzle-orm": "^0.36.4",
    "postgres": "^3.4.5",
    "stripe": "^17.5.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
EOF

        # 创建 tsconfig.json
        cat > "$CLOUD_DIR/tsconfig.json" << 'EOF'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
EOF

        # 创建基础 index.ts
        cat > "$CLOUD_DIR/src/index.ts" << 'EOF'
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * ServerPilot Cloud Edition — entry point.
 *
 * Provides PostgreSQL database support and cloud-only features
 * (AI quota management, Stripe billing, multi-tenant isolation).
 *
 * @module @aiinstaller/cloud
 */

export interface CloudBootstrapResult {
  dbType: 'postgres';
  close: () => Promise<void>;
}

/**
 * Bootstrap the cloud edition.
 */
export async function bootstrapCloud(): Promise<CloudBootstrapResult> {
  // TODO: Initialize PostgreSQL connection
  // TODO: Initialize AI quota manager
  // TODO: Initialize Stripe webhook handler

  return {
    dbType: 'postgres',
    close: async () => {
      // TODO: Cleanup
    },
  };
}
EOF

        log_success "已创建 Cloud 包基础结构"
    fi

    # 检查核心文件
    local cloud_files=(
        "packages/cloud/package.json"
        "packages/cloud/tsconfig.json"
        "packages/cloud/src/index.ts"
    )

    for f in "${cloud_files[@]}"; do
        if [ -f "$PROJECT_DIR/$f" ]; then
            log_success "Cloud 核心文件: $f"
        else
            log_warning "Cloud 核心文件缺失: $f"
        fi
    done

    # 检查依赖
    if [ -d "$CLOUD_DIR/node_modules" ]; then
        log_success "cloud 依赖已安装"
    else
        log_warning "cloud 依赖未安装，尝试安装..."
        cd "$PROJECT_DIR" && pnpm install
    fi

    # 检查云服务开发指南
    if [ -f "$PROJECT_DIR/docs/云服务开发指南.md" ]; then
        log_success "云服务开发指南存在"
    else
        log_error "云服务开发指南缺失: docs/云服务开发指南.md"
        return 1
    fi
}

# ============================================================================
# 钩子: 验证任务文件路径（安全检查）
# ============================================================================

module_validate_task() {
    local task_content="$1"

    # 检查影响范围是否都在 packages/cloud/ 下
    local impact_section=$(echo "$task_content" | sed -n '/\*\*影响范围\*\*/,/\*\*创建时间\*\*/p')

    # 查找影响范围中不在 packages/cloud/ 下的文件路径
    local non_cloud_files=$(echo "$impact_section" | grep -v 'packages/cloud/' | grep -E '\.(ts|tsx|jsx?|sql|json|md)' | grep -v '新建' | grep -v '可读取' | head -5)

    if [ -n "$non_cloud_files" ]; then
        log_error "❌ 任务影响范围包含 packages/cloud/ 目录外的文件，已拒绝执行！"
        log_error "以下文件不在 packages/cloud/ 目录内:"
        echo "$non_cloud_files" | while read -r file; do
            log_error "  - $file"
        done
        log_error ""
        log_error "Cloud 开发脚本只能修改 packages/cloud/ 目录下的文件。"
        log_error "虽然可以读取其他目录了解项目，但所有修改必须在 packages/cloud/ 下。"
        return 1
    fi

    log_success "✅ 任务路径验证通过 - 所有修改都在 packages/cloud/ 目录内"
    return 0
}

# ============================================================================
# 钩子: 任务队列初始内容
# ============================================================================

module_init_queue_header() {
    cat << 'EOF'
# ServerPilot Cloud 功能开发任务队列

> 此队列专注于 Cloud 版本的核心功能开发
> AI 自动发现任务 → 生成实现 → 测试 → 验证

**最后更新**: -

## 📊 统计

- **总任务数**: 0
- **待完成** (pending): 0
- **进行中** (in_progress): 0
- **已完成** (completed): 0
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动从云服务开发指南中提取任务)

---

## 开发优先级

### P0（核心价值，10天内完成）
1. **AI 配额管理**（3 天）
   - QuotaManager 实现
   - 中间件集成
   - Dashboard 配额显示

2. **Stripe 计费集成**（5 天）
   - 订阅创建
   - Webhook 处理
   - Dashboard 计费页面

3. **Agent 连接认证增强**（2 天）
   - Tenant 隔离检查
   - 订阅状态验证

### P1（重要功能，9天内完成）
4. 用户注册流程改造（3 天）
5. 使用量仪表盘（3 天）
6. Dashboard 多租户隔离（2 天）

### P2（企业功能，1个月内完成）
7. LiteLLM Gateway 部署（1 天）
8. PostgreSQL 迁移（1 周）
9. SAML SSO（1 周）
10. 自定义 Skills 开发（2 周）

## 核心理念

**ServerPilot Cloud 是 AI-Driven 运维平台，不是传统 SaaS：**
- ✅ 用户数据始终在用户服务器上
- ✅ Self-Hosted 和 Cloud 核心功能 100% 一致
- ✅ Cloud 用户付费购买 AI 智能能力，不是服务器托管
- ✅ 可随时降级到 Self-Hosted，无数据迁移
EOF
}

# ============================================================================
# 钩子: 启动信息 & 进度额外行
# ============================================================================

module_banner_info() {
    log_info "聚焦领域: AI 配额管理 | Stripe 计费 | 多租户架构 | Cloud Skills"
    log_info "核心理念: AI Agent 平台 | 用户付费买 AI 智能 | 无数据锁定"
}

# ============================================================================
# 钩子: 模块测试
# ============================================================================

module_run_tests() {
    log_info "运行 Cloud 功能测试..."

    cd "$CLOUD_DIR" || return 1

    # 1. TypeScript 类型检查（5分钟超时）
    if run_with_timeout 300 "TypeScript 类型检查" "pnpm typecheck" > "$TEST_LOG" 2>&1; then
        log_success "TypeScript 类型检查通过"
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            log_error "TypeScript 类型检查超时"
        else
            log_error "TypeScript 类型检查失败"
        fi
        tail -30 "$TEST_LOG"
        return 1
    fi

    # 2. 单元测试（5分钟超时）
    if run_with_timeout 300 "单元测试" "pnpm test" >> "$TEST_LOG" 2>&1; then
        log_success "单元测试通过"
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            log_error "单元测试超时"
        else
            log_error "单元测试失败"
        fi
        tail -30 "$TEST_LOG"
        return 1
    fi

    # 3. 构建测试（5分钟超时）
    if run_with_timeout 300 "构建" "pnpm build" >> "$TEST_LOG" 2>&1; then
        log_success "构建成功"
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            log_error "构建超时"
        else
            log_error "构建失败"
        fi
        tail -30 "$TEST_LOG"
        return 1
    fi

    log_success "Cloud 功能测试通过"
    return 0
}

# ============================================================================
# 钩子: Prompts
# ============================================================================

build_discover_prompt() {
    cat << 'PROMPT_EOF'
你是 ServerPilot 项目的 Cloud 功能开发工程师。你的任务是根据云服务开发指南，**自主发现需要实现的功能**，并生成开发任务。

## 你的职责

你不是在执行别人给你的任务，而是**自主分析开发指南，识别缺失功能**。像一个资深后端工程师 review 需求文档一样，找出真正需要实现的功能。

## 必须阅读的文档（按优先级）

### 核心需求文档
1. `docs/云服务开发指南.md` — **完整的功能规划和实现细节**（必读！）
2. `packages/cloud/src/index.ts` — Cloud 包入口
3. `packages/cloud/package.json` — 依赖配置

### 参考现有实现
4. `packages/server/src/db/schema.ts` — 数据库 schema（理解现有表结构）
5. `packages/server/src/api/middleware/` — 中间件实现参考
6. `packages/server/src/db/repositories/` — Repository 模式参考
7. `packages/shared/src/rbac.ts` — RBAC 权限系统

### 配置文件
8. `packages/cloud/tsconfig.json` — TypeScript 配置
9. `tsconfig.json` — 根配置（了解项目约定）

## 开发优先级（严格遵守！）

### P0（核心价值，立即实现）— **10 天内完成**

#### 1. AI 配额管理（3 天）
**文件**：
- `packages/cloud/src/ai/quota-manager.ts` — 核心配额管理类
- `packages/cloud/src/ai/quota-manager.test.ts` — 单元测试
- `packages/cloud/src/api/middleware/check-ai-quota.ts` — 中间件

**功能要求**：
- `AIQuotaManager` 类实现
- `checkQuota()` 方法：检查用户配额（Free 硬限制，付费软限制）
- `trackAICall()` 方法：记录 AI 调用和成本
- `getMonthlyCallCount()` 方法：统计本月调用次数
- `calculateCost()` 方法：计算调用成本
- 配额常量：`PLAN_QUOTAS`, `MODEL_PRICING`

**数据库表**：
- `ai_usage` 表（user_id, tenant_id, model, input_tokens, output_tokens, cost, timestamp）

**验收标准**：
- Free 用户超过 100 次/月返回 429 错误
- 付费用户超过软限制发送警告但不拒绝
- 所有 AI 调用都记录到数据库
- 测试覆盖率 > 90%

#### 2. Stripe 计费集成（5 天）
**文件**：
- `packages/cloud/src/billing/stripe-integration.ts` — Stripe 集成
- `packages/cloud/src/billing/stripe-integration.test.ts` — 单元测试
- `packages/cloud/src/api/routes/billing.ts` — 计费 API 路由

**功能要求**：
- `createSubscription()` 函数：创建订阅
- `handleStripeWebhook()` 函数：处理 Webhook 事件
- `handleSubscriptionUpdated()` 函数：订阅更新
- `handleSubscriptionCanceled()` 函数：订阅取消
- Stripe Price ID 映射：`PLAN_PRICE_IDS`
- 计划限制配置：`PLAN_LIMITS`

**数据库表**：
- `subscriptions` 表（tenant_id, user_id, plan, status, stripe_subscription_id, ...）

**验收标准**：
- 可以创建 Pro/Team/Enterprise 订阅
- Webhook 正确处理 4 种事件（created, updated, deleted, payment_failed）
- 订阅取消自动降级到 Free 计划
- 测试覆盖率 > 85%

#### 3. Agent 连接认证增强（2 天）
**文件**：
- `packages/cloud/src/websocket/cloud-agent-auth.ts` — Agent 认证增强
- `packages/cloud/src/websocket/cloud-agent-auth.test.ts` — 单元测试

**功能要求**：
- `authenticateCloudAgent()` 函数：验证 Agent 连接
- Tenant 隔离检查
- 订阅状态验证（past_due 拒绝连接）
- 服务器数量限制检查

**验收标准**：
- 无效 token 拒绝连接
- 订阅过期服务器无法连接
- 超过服务器数量限制拒绝连接
- 测试覆盖率 > 90%

### P1（重要功能）— **9 天内完成**

#### 4. 用户注册流程改造（3 天）
**文件**：
- `packages/cloud/src/auth/cloud-register.ts`
- `packages/cloud/src/auth/cloud-register.test.ts`

**功能要求**：
- `cloudRegister()` 函数：自动创建 Tenant
- 邮箱唯一性验证
- Tenant slug 生成（用于子域名）
- 欢迎邮件发送

#### 5. 使用量仪表盘（3 天）
**文件**：
- `packages/cloud/src/api/routes/usage.ts` — 使用量 API
- `packages/cloud/src/api/routes/usage.test.ts`

**功能要求**：
- `GET /api/v1/usage/summary` — 本月使用量统计
- `GET /api/v1/usage/history` — 历史趋势数据
- 按 tenant_id 隔离数据

#### 6. Dashboard 多租户隔离（2 天）
**文件**：
- `packages/cloud/src/api/middleware/verify-tenant.ts`
- `packages/cloud/src/api/middleware/verify-tenant.test.ts`

**功能要求**：
- `verifyTenant()` 中间件：防止伪造 tenantId
- JWT 中的 tenantId 与 Header 对比

## 发现任务的方法

1. **阅读开发指南**：仔细阅读 `docs/云服务开发指南.md`，提取所有待实现功能
2. **检查现有代码**：查看 `packages/cloud/src/` 下已有文件，对比开发指南
3. **识别缺失**：找出开发指南中提到但代码中不存在的功能
4. **优先级排序**：严格按照 P0 > P1 > P2 顺序生成任务
5. **拆分任务**：每个任务 1-2 小时可完成，单文件不超过 500 行

## 技术约束

- **数据库**：使用 PostgreSQL（drizzle-orm + postgres）
- **TypeScript**：严格模式，完整类型定义
- **测试**：Vitest，覆盖率 > 85%
- **许可证**：BUSL-1.1（商业源码许可）
- **依赖**：优先使用 workspace 内的包（@aiinstaller/shared）

## 代码修改限制（强制！）

- **可以读取**：项目任何目录的文件（了解项目背景、复用代码）
- **只能修改/新建**：`packages/cloud/` 目录下的文件
- **影响范围必须全部在 packages/cloud/ 目录内**
- **禁止修改**：packages/server/, packages/agent/, packages/dashboard/ 等其他包

## 输出格式（严格！）

你的输出必须且只能是一个 ```tasks 代码块，不要输出任何其他内容。

```tasks
### [pending] 任务标题（简明描述功能）

**ID**: cloud-XXX
**优先级**: P0/P1/P2
**模块路径**: packages/cloud/src/xxx/
**功能需求**: 根据开发指南的具体功能要求（引用开发指南章节）
**实现方案**: 详细说明如何实现（类、函数、数据库表）
**验收标准**: 功能完成后应该达到的效果
**影响范围**: 这个功能会创建/修改哪些文件（必须在 packages/cloud/ 下）
**依赖**: 依赖的其他功能或包
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] 另一个任务...
```

## 重要约束

- **输出格式**：只输出 ```tasks 代码块，不要输出分析报告
- **优先级**：先生成所有 P0 任务，P0 完成后才生成 P1
- **任务粒度**：每个任务 1-2 小时，单文件不超过 500 行
- **必须引用开发指南**：在 "功能需求" 中引用具体章节
- **完整实现**：包含主代码 + 测试 + 类型定义
- **测试要求**：每个功能必须有对应的 .test.ts 文件
- **不要重复**：先检查 CLOUD_TASK_QUEUE.md 中已完成的任务

直接输出 ```tasks 代码块，不要输出任何前言或分析：
PROMPT_EOF
}

build_execute_prompt() {
    local task_content="$1"

    cat << EOF
你是 ServerPilot 项目的 Cloud 功能开发工程师，正在实现一个具体的云服务功能。

## 项目信息

- **包名**: @aiinstaller/cloud
- **许可证**: BUSL-1.1（商业源码许可）
- **数据库**: PostgreSQL（drizzle-orm）
- **测试框架**: Vitest
- **TypeScript**: 严格模式
- **包管理**: pnpm workspace

## 技术栈约束

- **数据库 ORM**: drizzle-orm + postgres
- **测试**: Vitest（覆盖率 > 85%）
- **类型安全**: 完整的 TypeScript 类型定义
- **依赖管理**: 优先使用 @aiinstaller/shared
- **错误处理**: 统一的错误类型和消息

## 当前任务

$task_content

## 开发约束

- **聚焦**: 只实现当前任务，不要扩散到其他功能
- **代码质量**: 遵循项目现有代码风格
- **测试优先**: 每个功能必须有对应的 .test.ts
- **类型完整**: 所有函数参数和返回值都有类型
- **单文件限制**: 不超过 500 行（硬限制 800 行）
- **⚠️ 代码修改限制（强制！）**:
  - 可以读取项目其他目录的文件（了解项目背景、复用类型）
  - 只能修改/新建 packages/cloud/ 目录下的文件
  - 所有代码、测试、类型的修改必须在 packages/cloud/ 下
  - 如果任务需要修改 packages/cloud/ 外的文件，立即停止并报告错误

## 数据库 Schema 规范

所有 Cloud 表必须包含：
- \`tenant_id\` 列（用于多租户隔离）
- 时间戳字段（created_at, updated_at）
- 主键使用 SERIAL
- 外键约束完整

## 测试要求

每个功能必须包含：
1. **单元测试**：测试核心逻辑
2. **边界测试**：测试边界条件
3. **错误测试**：测试错误处理
4. **覆盖率**：> 85%

测试文件命名：\`xxx.test.ts\`

## 参考现有实现

可以参考以下文件的实现模式：
- \`packages/server/src/db/repositories/\` — Repository 模式
- \`packages/server/src/api/middleware/\` — 中间件模式
- \`packages/shared/src/rbac.ts\` — 权限系统

## 测试验证

完成后运行:
\`\`\`bash
cd packages/cloud
pnpm typecheck    # TypeScript 类型检查
pnpm test         # 单元测试
pnpm build        # 构建测试
\`\`\`

开始实现...
EOF
}

build_fix_prompt() {
    local test_output="$1"

    cat << EOF
Cloud 功能实现后测试失败，请分析并修复。

## 测试输出
$test_output

## 修复要求

1. 分析测试失败的根本原因
2. 定位问题代码（一定在最近的改动中）
3. 修复代码而不是削弱测试
4. 确保修复不引入新问题
5. 保持类型完整性

## 常见问题

- **类型错误**：检查 TypeScript 类型定义是否完整
- **导入路径**：检查是否使用正确的相对路径和扩展名 .js
- **数据库查询**：检查 drizzle-orm 查询语法
- **异步处理**：检查 async/await 使用是否正确
- **测试断言**：检查测试断言是否准确

## 关键注意

- PostgreSQL 语法与 SQLite 不同（注意数据类型）
- Drizzle ORM 查询必须正确构造
- 测试中的 mock 必须正确设置
- 所有异步操作必须 await

开始修复...
EOF
}

# ============================================================================
# 加载公共模块并运行
# ============================================================================

source "$SCRIPT_DIR/autorun-common.sh"
autorun_main "$@"
