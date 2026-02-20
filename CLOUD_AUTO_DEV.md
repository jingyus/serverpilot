# Cloud 功能自动开发指南

> 使用 AI 自动实现 ServerPilot Cloud 功能

---

## 📋 目录

- [快速开始](#快速开始)
- [功能概述](#功能概述)
- [开发优先级](#开发优先级)
- [使用方式](#使用方式)
- [工作流程](#工作流程)
- [安全约束](#安全约束)
- [常见问题](#常见问题)

---

## 🚀 快速开始

### 1. 启动自动开发

```bash
cd /Users/chunyujing/Documents/project/ServerPilot
./scripts/autorun_cloud.sh
```

### 2. 查看任务状态

```bash
./scripts/autorun_cloud.sh --status
```

### 3. 查看失败任务

```bash
./scripts/autorun_cloud.sh --show-failures
```

### 4. 重置失败任务

```bash
./scripts/autorun_cloud.sh --reset-failures
```

---

## 💡 功能概述

`autorun_cloud.sh` 是一个 **AI 驱动的自动开发脚本**，专门用于实现 ServerPilot Cloud 功能。

### 核心能力

1. **自动任务发现**
   - 读取 `docs/云服务开发指南.md`
   - 自动识别未实现的功能
   - 按 P0/P1/P2 优先级生成任务

2. **智能代码实现**
   - 根据开发指南自动编写代码
   - 自动生成单元测试（覆盖率 > 85%）
   - 自动生成 TypeScript 类型定义

3. **自动测试验证**
   - TypeScript 类型检查
   - 单元测试
   - 构建测试

4. **自动 Git 提交**
   - 每个任务成功后自动提交
   - 失败自动回滚
   - 自动创建分支 `feat/cloud-develop-YYYYMMDD`

### 开发范围

✅ **只修改**: `packages/cloud/` 目录
❌ **禁止修改**: `packages/server/`, `packages/agent/`, `packages/dashboard/`

---

## 🎯 开发优先级

### P0（核心价值，10天内完成）

#### 1. AI 配额管理（3 天）
- ✅ QuotaManager 实现
- ✅ 中间件集成
- ✅ Dashboard 配额显示

**预期产出**：
- `packages/cloud/src/ai/quota-manager.ts`
- `packages/cloud/src/ai/quota-manager.test.ts`
- `packages/cloud/src/api/middleware/check-ai-quota.ts`

#### 2. Stripe 计费集成（5 天）
- ✅ 订阅创建
- ✅ Webhook 处理
- ✅ Dashboard 计费页面

**预期产出**：
- `packages/cloud/src/billing/stripe-integration.ts`
- `packages/cloud/src/billing/stripe-integration.test.ts`
- `packages/cloud/src/api/routes/billing.ts`

#### 3. Agent 连接认证增强（2 天）
- ✅ Tenant 隔离检查
- ✅ 订阅状态验证

**预期产出**：
- `packages/cloud/src/websocket/cloud-agent-auth.ts`
- `packages/cloud/src/websocket/cloud-agent-auth.test.ts`

### P1（重要功能，9天内完成）

4. 用户注册流程改造（3 天）
5. 使用量仪表盘（3 天）
6. Dashboard 多租户隔离（2 天）

### P2（企业功能，1个月内完成）

7. LiteLLM Gateway 部署（1 天）
8. PostgreSQL 迁移（1 周）
9. SAML SSO（1 周）
10. 自定义 Skills 开发（2 周）

---

## 📖 使用方式

### 基础用法

```bash
# 启动自动开发（无限循环）
./scripts/autorun_cloud.sh

# 查看帮助
./scripts/autorun_cloud.sh --help
```

### 任务管理

```bash
# 查看任务统计
./scripts/autorun_cloud.sh --status

# 查看失败任务详情
./scripts/autorun_cloud.sh --show-failures

# 重置所有失败任务（重新尝试）
./scripts/autorun_cloud.sh --reset-failures
```

### 环境变量配置

```bash
# 循环间隔（秒）
export INTERVAL=30

# 最大迭代次数
export MAX_ITERATIONS=1000

# 单轮最大重试次数
export MAX_RETRIES=3

# 跨轮最大失败次数
export MAX_TASK_FAILURES=3

# 执行超时（秒）
export EXECUTE_TIMEOUT=3600

# Token 限制
export MAX_TOKENS=10000000
```

---

## 🔄 工作流程

### 完整流程图

```
┌─────────────────────────────────────────────────────────┐
│  1. AI 扫描开发指南                                       │
│     - 读取 docs/云服务开发指南.md                        │
│     - 识别未实现的功能                                   │
│     - 生成任务列表（P0 > P1 > P2）                       │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  2. 任务队列管理                                         │
│     - 添加任务到 CLOUD_TASK_QUEUE.md                    │
│     - 按优先级排序                                       │
│     - 标记任务状态（pending/in_progress/completed）      │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  3. 获取下一个任务                                       │
│     - 优先选择 P0 任务                                   │
│     - 检查依赖是否满足                                   │
│     - 创建 Git 检查点                                    │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  4. AI 实现功能                                          │
│     - 读取任务需求                                       │
│     - 生成代码（主代码 + 测试）                          │
│     - 遵守代码约束（只修改 packages/cloud/）            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│  5. 自动测试验证                                         │
│     - TypeScript 类型检查                                │
│     - 单元测试（vitest）                                 │
│     - 构建测试（pnpm build）                             │
└─────────────────────────────────────────────────────────┘
                        ↓
                   测试通过？
                  ↙        ↘
               是            否
                ↓            ↓
┌──────────────────┐  ┌──────────────────┐
│  6. Git 提交      │  │  7. AI 修复       │
│  - 自动提交代码  │  │  - 分析失败原因   │
│  - 标记任务完成  │  │  - 修复代码       │
│  - 推送到远程    │  │  - 重新测试       │
└──────────────────┘  └──────────────────┘
        ↓                      ↓
        └──────────┬───────────┘
                   ↓
              修复成功？
             ↙        ↘
          是            否
           ↓            ↓
    继续下一个任务    回滚代码
                      标记失败
                      重试或跳过
```

### 详细步骤

#### 第 1 步：AI 扫描开发指南

AI 读取 `docs/云服务开发指南.md`，提取：
- P0 功能（AI 配额管理、Stripe 计费、Agent 认证）
- P1 功能（用户注册、使用量仪表盘、Dashboard 隔离）
- P2 功能（LiteLLM Gateway、PostgreSQL 迁移、SAML SSO）

#### 第 2 步：生成任务

每个功能拆分为 1-2 小时的任务：

```markdown
### [pending] 实现 AI 配额管理核心类

**ID**: cloud-001
**优先级**: P0
**模块路径**: packages/cloud/src/ai/
**功能需求**: 实现 AIQuotaManager 类，支持 Free 用户硬限制和付费用户软限制
**实现方案**:
- 创建 quota-manager.ts
- checkQuota() 方法
- trackAICall() 方法
- PLAN_QUOTAS 常量
**验收标准**:
- Free 用户超过 100 次/月返回 429 错误
- 付费用户超过软限制发送警告但不拒绝
- 测试覆盖率 > 90%
**影响范围**:
- 新建: packages/cloud/src/ai/quota-manager.ts
- 新建: packages/cloud/src/ai/quota-manager.test.ts
```

#### 第 3 步：AI 实现

AI 自动生成：

1. **主代码**：
```typescript
// packages/cloud/src/ai/quota-manager.ts
export class AIQuotaManager {
  async checkQuota(userId: string, tenantId: string): Promise<QuotaCheckResult> {
    // ... 实现代码
  }

  async trackAICall(userId: string, call: AICallMetrics) {
    // ... 实现代码
  }
}
```

2. **单元测试**：
```typescript
// packages/cloud/src/ai/quota-manager.test.ts
describe('AIQuotaManager', () => {
  test('Free 用户超过配额应拒绝', async () => {
    // ... 测试代码
  });

  test('付费用户超过软限制发警告', async () => {
    // ... 测试代码
  });
});
```

#### 第 4 步：自动测试

```bash
cd packages/cloud
pnpm typecheck  # TypeScript 类型检查
pnpm test       # 单元测试
pnpm build      # 构建测试
```

#### 第 5 步：Git 提交

```bash
git add packages/cloud/
git commit -m "feat(cloud): 实现 AI 配额管理核心类

- 添加 AIQuotaManager 类
- 实现 checkQuota() 和 trackAICall()
- 添加单元测试（覆盖率 92%）

Generated-By: autorun_cloud.sh (Cloud Feature Development)
Task-File: CURRENT_CLOUD_TASK.md
Round: 1
Status: ✅ 完成"
```

#### 第 6 步：继续下一个任务

循环回到第 1 步，直到所有 P0 任务完成。

---

## 🔒 安全约束

### 代码修改范围

✅ **允许修改**：
- `packages/cloud/src/**/*.ts`
- `packages/cloud/src/**/*.test.ts`
- `packages/cloud/package.json`
- `packages/cloud/tsconfig.json`

❌ **禁止修改**：
- `packages/server/` — 服务器核心代码
- `packages/agent/` — Agent 代码
- `packages/dashboard/` — Dashboard 代码
- `packages/shared/` — 共享代码（除非必要）

### 路径验证

脚本会自动验证任务的影响范围：

```bash
# 如果任务影响范围包含非 packages/cloud/ 文件
❌ 任务影响范围包含 packages/cloud/ 目录外的文件，已拒绝执行！

以下文件不在 packages/cloud/ 目录内:
  - packages/server/src/api/routes/billing.ts
  - packages/dashboard/src/pages/Billing.tsx

Cloud 开发脚本只能修改 packages/cloud/ 目录下的文件。
虽然可以读取其他目录了解项目，但所有修改必须在 packages/cloud/ 下。
```

### 依赖限制

优先使用项目内部包：
- ✅ `@aiinstaller/shared` — 共享类型和工具
- ✅ `drizzle-orm` — 数据库 ORM
- ✅ `stripe` — Stripe SDK
- ❌ 不随意引入新的第三方依赖

---

## ❓ 常见问题

### Q1: 脚本卡住不动了怎么办？

**原因**：可能是 Claude AI 进程卡死或超时。

**解决**：
1. 按 `Ctrl+C` 停止脚本
2. 检查日志：`tail -100 autorun_cloud.log`
3. 查看当前任务：`cat CURRENT_CLOUD_TASK.md`
4. 重新启动脚本（会自动恢复未完成任务）

### Q2: 任务失败后会自动重试吗？

**会的**。脚本有智能重试机制：

- **单轮重试**：每个任务最多重试 3 次（`MAX_RETRIES=3`）
- **跨轮重试**：失败任务会在下一轮自动重试，累计失败 3 次后永久失败（`MAX_TASK_FAILURES=3`）
- **自动回滚**：失败后自动回滚代码到任务执行前的状态

### Q3: 如何重置永久失败的任务？

```bash
# 查看失败任务
./scripts/autorun_cloud.sh --show-failures

# 重置所有失败任务
./scripts/autorun_cloud.sh --reset-failures
```

### Q4: 生成的代码质量如何？

**质量保证机制**：

1. **类型检查**：所有代码必须通过 TypeScript 类型检查
2. **单元测试**：覆盖率 > 85%
3. **构建测试**：必须能成功构建
4. **代码风格**：遵循项目现有代码风格
5. **AI 修复**：测试失败会自动触发 AI 修复

### Q5: Token 使用量会很大吗？

**Token 使用估算**：

- **单个任务**：约 10K-30K tokens（输入 + 输出）
- **P0 全部**（3个功能）：约 200K tokens
- **P1 全部**（3个功能）：约 150K tokens
- **总计**：约 500K-800K tokens（费用约 $15-$25）

**成本控制**：
- 设置 Token 限制：`MAX_TOKENS=10000000`（默认 1000 万）
- 实时成本追踪：`tail -f CLOUD_TOKEN_USAGE.log`

### Q6: 如何查看开发进度？

```bash
# 查看任务统计
./scripts/autorun_cloud.sh --status

# 输出示例：
Cloud (云服务)任务统计
  总计: 15 | 待完成: 5 | 进行中: 1 | 已完成: 8 | 失败: 1
```

### Q7: 生成的代码在哪里？

```bash
# 所有代码都在这个目录
packages/cloud/src/

# 目录结构：
packages/cloud/
├── src/
│   ├── ai/
│   │   ├── quota-manager.ts
│   │   └── quota-manager.test.ts
│   ├── billing/
│   │   ├── stripe-integration.ts
│   │   └── stripe-integration.test.ts
│   ├── websocket/
│   │   ├── cloud-agent-auth.ts
│   │   └── cloud-agent-auth.test.ts
│   ├── auth/
│   │   ├── cloud-register.ts
│   │   └── cloud-register.test.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

### Q8: 如何手动执行某个任务？

1. 编辑 `CLOUD_TASK_QUEUE.md`
2. 将任务状态改为 `[pending]`
3. 重新启动脚本（会自动执行 pending 任务）

---

## 📊 预期产出

### P0 完成后（10 天）

```
packages/cloud/src/
├── ai/
│   ├── quota-manager.ts          # AI 配额管理核心
│   ├── quota-manager.test.ts     # 单元测试
│   └── index.ts                  # 导出
├── billing/
│   ├── stripe-integration.ts     # Stripe 集成
│   ├── stripe-integration.test.ts
│   └── index.ts
├── websocket/
│   ├── cloud-agent-auth.ts       # Agent 认证增强
│   ├── cloud-agent-auth.test.ts
│   └── index.ts
├── api/
│   ├── middleware/
│   │   └── check-ai-quota.ts     # 配额检查中间件
│   └── routes/
│       └── billing.ts            # 计费 API
└── index.ts                      # Cloud 包入口
```

### P1 完成后（19 天）

新增：
```
packages/cloud/src/
├── auth/
│   ├── cloud-register.ts         # 注册流程改造
│   └── cloud-register.test.ts
├── api/
│   ├── routes/
│   │   └── usage.ts              # 使用量 API
│   └── middleware/
│       └── verify-tenant.ts      # Tenant 验证
└── db/
    ├── pg-connection.ts          # PostgreSQL 连接
    ├── pg-schema.ts              # Cloud 表 schema
    └── pg-migrate.ts             # 迁移工具
```

### 测试覆盖率

- **P0**: > 90%（核心功能必须高覆盖）
- **P1**: > 85%（重要功能）
- **P2**: > 80%（企业功能）

---

## 🎉 完成标准

### P0 验收标准

✅ **AI 配额管理**：
- Free 用户超过 100 次/月返回 429 错误
- 付费用户超过软限制发送警告但不拒绝
- 所有 AI 调用都记录到 `ai_usage` 表
- 测试覆盖率 > 90%

✅ **Stripe 计费集成**：
- 可以创建 Pro/Team/Enterprise 订阅
- Webhook 正确处理 4 种事件
- 订阅取消自动降级到 Free 计划
- 测试覆盖率 > 85%

✅ **Agent 连接认证增强**：
- 无效 token 拒绝连接
- 订阅过期服务器无法连接
- 超过服务器数量限制拒绝连接
- 测试覆盖率 > 90%

---

## 📚 相关文档

- [云服务开发指南](docs/云服务开发指南.md) — 完整功能规划
- [LICENSING.md](LICENSING.md) — 开源许可与商业模式
- [README.md](README.md) — 项目概览

---

## 📝 日志文件

- `autorun_cloud.log` — 执行日志
- `AUTORUN_CLOUD_STATE.md` — 状态记录
- `CLOUD_TASK_QUEUE.md` — 任务队列
- `CURRENT_CLOUD_TASK.md` — 当前任务
- `CLOUD_TOKEN_USAGE.log` — Token 使用统计
- `cloud_test.log` — 测试日志

---

## 🚀 开始使用

```bash
# 1. 启动自动开发
./scripts/autorun_cloud.sh

# 2. 观察日志（另一个终端）
tail -f autorun_cloud.log

# 3. 查看任务进度（另一个终端）
watch -n 5 "./scripts/autorun_cloud.sh --status"

# 4. 等待 AI 自动完成所有 P0 功能 🎉
```

---

<p align="center">
  <sub>Built with 🤖 AI by the ServerPilot team</sub>
</p>
