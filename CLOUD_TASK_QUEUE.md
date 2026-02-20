# ServerPilot Cloud 功能开发任务队列

> 此队列专注于 Cloud 版本的核心功能开发
> AI 自动发现任务 → 生成实现 → 测试 → 验证

**最后更新**: 2026-02-15 15:27:12

## 📊 统计

- **总任务数**: 18
- **待完成** (pending): 0
- **进行中** (in_progress): 0
- **已完成** (completed): 18
- **失败** (failed): 0

## 📋 任务列表

(AI 将自动从云服务开发指南中提取任务)
### [completed] AI 配额管理 — 数据库表与常量定义 ✅

**ID**: cloud-001
**优先级**: P0
**模块路径**: packages/cloud/src/ai/
**功能需求**: 根据开发指南「AI 成本核算与定价」和「关键缺失功能 → AI 配额管理」章节，定义 AI 使用记录表 `ai_usage`、路由日志表 `ai_routing_logs`，以及计划配额常量 `PLAN_QUOTAS` 和模型定价常量 `MODEL_PRICING`。当前 pg-schema.ts 中不存在这两张表，billing/index.ts 中 PLANS 定义的价格和限制与开发指南不一致（指南：Free $0 100次/月，Pro $19 2000次/月，Team $49，Enterprise $199；现有代码：Free $0 3台，Pro $29 25台，Enterprise $99）。
**实现方案**:
- 在 `pg-schema.ts` 中添加 `ai_usage` 表（id, userId, tenantId, model, inputTokens, outputTokens, cost, timestamp）和 `ai_routing_logs` 表（id, userId, command, riskLevel, conversationLength, selectedModel, actualCost, timestamp）
- 创建 `packages/cloud/src/ai/constants.ts`：定义 `PLAN_QUOTAS`（free: maxCalls 100, pro: maxCalls 2000 + softLimit $50, team: softLimit $200, enterprise: softLimit $1000）和 `MODEL_PRICING`（haiku/sonnet/opus 三档定价）
- 创建 `packages/cloud/src/ai/types.ts`：定义 `QuotaCheckResult`, `AICallMetrics`, `QuotaStatus`, `ModelName` 等类型
- 更新 `billing/index.ts` 中 PLANS 与开发指南一致（添加 team 计划、修正价格和限制）
**验收标准**:
- pg-schema.ts 包含 ai_usage 和 ai_routing_logs 两张表定义
- PLAN_QUOTAS 和 MODEL_PRICING 常量与开发指南数据完全一致
- 类型定义完整，包含 QuotaCheckResult（allowed, remaining, reason?, upgradeUrl?）
- pg-schema.test.ts 更新验证新表存在
**影响范围**: packages/cloud/src/db/pg-schema.ts, packages/cloud/src/db/pg-schema.test.ts, packages/cloud/src/ai/constants.ts, packages/cloud/src/ai/types.ts, packages/cloud/src/billing/index.ts
**依赖**: 无（基础数据定义）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:32:32

---

### [completed] AI 配额管理 — AIQuotaManager 核心实现 ✅

**ID**: cloud-002
**优先级**: P0
**模块路径**: packages/cloud/src/ai/
**功能需求**: 根据开发指南「关键缺失功能 → AI 配额管理」章节的 `AIQuotaManager` 类设计，实现完整的配额检查、AI 调用追踪和成本计算逻辑。Free 用户 100 次/月硬限制（超过返回 429），付费用户公平使用软限制（超过发警告但不拒绝）。
**实现方案**:
- 创建 `packages/cloud/src/ai/quota-manager.ts`：
  - `AIQuotaManager` 类，singleton 模式（`getAIQuotaManager()` / `_resetAIQuotaManager()`）
  - `checkQuota(userId, tenantId)` → 查询 tenant plan → free 查次数 / 付费查成本 → 返回 QuotaCheckResult
  - `trackAICall(userId, call: AICallMetrics)` → 插入 ai_usage 记录 → 实时检查配额
  - `getMonthlyCallCount(userId)` → 查询本月调用次数（WHERE timestamp >= startOfMonth）
  - `getMonthlyCost(userId)` → 聚合本月成本
  - `calculateCost(call)` → 根据 MODEL_PRICING 计算单次成本
  - `sendUsageWarning(userId, usage)` → 发送软限制预警（日志记录，后续对接邮件）
- 创建 `packages/cloud/src/ai/quota-manager.test.ts`：≥20 个测试覆盖
  - free 用户 99 次通过、100 次拒绝
  - pro 用户超软限制发警告但通过
  - 成本计算精度（haiku/sonnet/opus 各验证）
  - 月初重置逻辑
  - singleton 创建与重置
**验收标准**:
- Free 用户超过 100 次/月返回 `{ allowed: false, reason: '...', upgradeUrl: '/billing?upgrade=pro' }`
- 付费用户超软限制返回 `{ allowed: true }` 但触发 warning
- calculateCost 与开发指南定价一致（haiku $0.0033/次, sonnet $0.039/次, opus $0.195/次）
- 测试覆盖率 > 90%
**影响范围**: packages/cloud/src/ai/quota-manager.ts, packages/cloud/src/ai/quota-manager.test.ts
**依赖**: cloud-001（表定义和常量）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:36:58

---

### [completed] AI 配额管理 — check-ai-quota 中间件 ✅

**ID**: cloud-003
**优先级**: P0
**模块路径**: packages/cloud/src/api/middleware/
**功能需求**: 根据开发指南「中间件集成」章节，创建 Hono 中间件 `checkAIQuota()`，在 AI 相关 API 路由前检查用户配额。配额超限返回 429 + QUOTA_EXCEEDED 错误码 + upgradeUrl。响应头中添加 `X-Quota-Remaining` 显示剩余配额。
**实现方案**:
- 创建 `packages/cloud/src/api/middleware/check-ai-quota.ts`：
  - `checkAIQuota()` 工厂函数返回 Hono 中间件
  - 从 context 提取 `userId` 和 `tenantId`（来自 auth 中间件注入）
  - 调用 `getAIQuotaManager().checkQuota()` 检查配额
  - 配额不足 → 返回 `{ error: { code: 'QUOTA_EXCEEDED', message, upgradeUrl } }` 状态 429
  - 配额充足 → 设置 `X-Quota-Remaining` header → next()
- 创建 `packages/cloud/src/api/middleware/check-ai-quota.test.ts`：≥12 个测试
  - free 用户配额充足 → 200
  - free 用户配额耗尽 → 429 + QUOTA_EXCEEDED
  - 付费用户始终通过（即使超软限制）
  - X-Quota-Remaining header 正确
  - 未认证请求处理
**验收标准**:
- 429 响应包含 `{ error: { code: 'QUOTA_EXCEEDED', message, upgradeUrl } }`
- 响应头包含 `X-Quota-Remaining` 数字
- 不影响付费用户正常使用（软限制只警告）
- 测试覆盖率 > 90%
**影响范围**: packages/cloud/src/api/middleware/check-ai-quota.ts, packages/cloud/src/api/middleware/check-ai-quota.test.ts
**依赖**: cloud-002（AIQuotaManager）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:42:14

---

### [completed] Stripe 计费集成 — subscriptions 表与 Stripe 常量 ✅

**ID**: cloud-004
**优先级**: P0
**模块路径**: packages/cloud/src/billing/
**功能需求**: 根据开发指南「Stripe 计费集成」和「数据库 Schema → 订阅管理」章节，定义 subscriptions 数据库表和 Stripe 相关常量（Price ID 映射、计划限制）。当前 pg-schema.ts 中不存在 subscriptions 表。
**实现方案**:
- 在 `pg-schema.ts` 中添加 `subscriptions` 表（id, tenantId, userId, plan, status, stripeSubscriptionId, stripeCustomerId, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, createdAt, updatedAt）
- 创建 `packages/cloud/src/billing/constants.ts`：
  - `PLAN_PRICE_IDS`：pro/team/enterprise → Stripe Price ID 映射（可配置 via env）
  - `PLAN_LIMITS`：各计划服务器数和用户数限制（free: 1/1, pro: 10/5, team/enterprise: Infinity）
  - `SubscriptionStatus` 类型：incomplete/active/past_due/canceled/unpaid
- 创建 `packages/cloud/src/billing/types.ts`：StripeWebhookEvent, CreateSubscriptionResult 等类型
**验收标准**:
- subscriptions 表定义完整，包含所有字段和索引
- PLAN_LIMITS 与开发指南一致
- 类型定义覆盖所有 Stripe 交互场景
**影响范围**: packages/cloud/src/db/pg-schema.ts, packages/cloud/src/db/pg-schema.test.ts, packages/cloud/src/billing/constants.ts, packages/cloud/src/billing/types.ts
**依赖**: cloud-001（需要和 ai_usage 表一起更新 schema）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:47:50

---

### [completed] Stripe 计费集成 — 订阅管理服务 ✅

**ID**: cloud-005
**优先级**: P0
**模块路径**: packages/cloud/src/billing/
**功能需求**: 根据开发指南「Stripe 计费集成」章节的 `createSubscription()` 函数设计，实现完整的 Stripe 订阅创建流程。包括 Stripe Customer 创建/获取、订阅创建（payment_behavior: default_incomplete）、返回 clientSecret 给前端确认支付。
**实现方案**:
- 创建 `packages/cloud/src/billing/stripe-integration.ts`：
  - `getStripeClient()` 工厂函数（可 mock）
  - `createSubscription(userId, tenantId, plan)` → 创建/获取 Customer → 创建 Subscription → 存 DB → 返回 clientSecret
  - `cancelSubscription(subscriptionId)` → 标记 cancelAtPeriodEnd
  - `getSubscription(tenantId)` → 查询当前订阅
  - `updateSubscriptionPlan(subscriptionId, newPlan)` → 变更计划
- 创建 `packages/cloud/src/billing/stripe-integration.test.ts`：≥16 个测试
  - 新用户创建 Customer + Subscription
  - 已有 Customer 直接创建 Subscription
  - 返回 clientSecret 格式正确
  - 取消订阅标记 cancelAtPeriodEnd
  - 错误处理（无效 plan、Stripe API 失败）
- 需要在 package.json 添加 `stripe` 依赖
**验收标准**:
- 可以创建 Pro/Team/Enterprise 订阅
- 返回 `{ subscriptionId, clientSecret }` 给前端
- 取消订阅不立即生效（到期取消）
- Stripe SDK 调用正确（mock 验证）
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/billing/stripe-integration.ts, packages/cloud/src/billing/stripe-integration.test.ts, packages/cloud/package.json
**依赖**: cloud-004（subscriptions 表和常量）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:54:56

---

### [completed] Stripe 计费集成 — Webhook 处理器 ✅

**ID**: cloud-006
**优先级**: P0
**模块路径**: packages/cloud/src/billing/
**功能需求**: 根据开发指南「Stripe Webhook 处理」章节，实现 4 种 Webhook 事件处理：subscription.created/updated（激活订阅、更新 tenant plan）、subscription.deleted（降级 Free）、invoice.payment_failed（标记 past_due）、invoice.payment_succeeded（确认支付）。
**实现方案**:
- 创建 `packages/cloud/src/billing/stripe-webhook.ts`：
  - `handleStripeWebhook(payload, signature)` → constructEvent → switch event.type
  - `handleSubscriptionUpdated(subscription)` → 更新 tenant plan + maxServers/maxUsers + subscription status
  - `handleSubscriptionCanceled(subscription)` → 降级 tenant 到 free（maxServers:1, maxUsers:1）+ 发送通知邮件
  - `handlePaymentFailed(invoice)` → 标记 subscription past_due + 发送付款失败通知
  - `handlePaymentSucceeded(invoice)` → 确认订阅激活
- 创建 `packages/cloud/src/billing/stripe-webhook.test.ts`：≥14 个测试
  - 签名验证成功/失败
  - subscription.created → tenant plan 更新
  - subscription.deleted → 降级到 free
  - payment_failed → 标记 past_due
  - 未知 event type → 忽略不报错
**验收标准**:
- Webhook 正确处理 4 种事件
- 订阅取消自动降级到 Free 计划（maxServers:1, maxUsers:1）
- 签名验证使用 STRIPE_WEBHOOK_SECRET
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/billing/stripe-webhook.ts, packages/cloud/src/billing/stripe-webhook.test.ts
**依赖**: cloud-005（stripe-integration 中的辅助函数）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 14:58:52

---

### [completed] Stripe 计费集成 — 计费 API 路由 ✅

**ID**: cloud-007
**优先级**: P0
**模块路径**: packages/cloud/src/api/routes/
**功能需求**: 根据开发指南「Stripe 计费集成」需求，创建计费相关 API 路由。包括创建订阅、查看订阅状态、取消订阅、Stripe Webhook 端点。
**实现方案**:
- 创建 `packages/cloud/src/api/routes/billing.ts`：
  - `POST /api/v1/billing/subscribe` — 创建订阅（requireAuth + requirePermission('tenant:manage')）
  - `GET /api/v1/billing/subscription` — 查看当前订阅状态
  - `POST /api/v1/billing/cancel` — 取消订阅（cancelAtPeriodEnd）
  - `POST /api/v1/billing/webhook` — Stripe Webhook 端点（无 auth，用签名验证）
  - `GET /api/v1/billing/plans` — 获取可用计划列表（公开端点）
- 创建 `packages/cloud/src/api/routes/billing.test.ts`：≥15 个测试
  - subscribe → 200 + clientSecret
  - subscribe 无效 plan → 400
  - subscription 查询 → 当前状态
  - cancel → 标记取消
  - webhook → 正确路由到处理器
  - 权限检查（非 owner 不能管理订阅）
**验收标准**:
- 所有 API 端点正常工作
- 权限控制正确（只有 owner/admin 可管理订阅）
- Webhook 端点无需 auth，使用 Stripe 签名验证
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/api/routes/billing.ts, packages/cloud/src/api/routes/billing.test.ts
**依赖**: cloud-005, cloud-006（Stripe 集成和 Webhook 处理）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:05:08

---

### [completed] Agent 连接认证增强 — Cloud Agent 认证 ✅

**ID**: cloud-008
**优先级**: P0
**模块路径**: packages/cloud/src/websocket/
**功能需求**: 根据开发指南「Agent 连接认证增强」章节，实现 `authenticateCloudAgent()` 函数。在现有 Agent 认证基础上增加：Tenant 隔离检查（server 必须属于有效 tenant）、订阅状态验证（past_due 拒绝连接）、服务器数量限制检查（超过 maxServers 拒绝新连接）。
**实现方案**:
- 创建 `packages/cloud/src/websocket/cloud-agent-auth.ts`：
  - `authenticateCloudAgent(serverId, agentToken)` → 验证 token → 检查 tenant → 检查订阅状态 → 检查服务器数量 → 返回 CloudAuthResult
  - `CloudAuthResult` 类型：{ server, tenant, userId, permissions }
  - 错误情况：Invalid token / Tenant not found / Subscription expired / Server limit exceeded
- 创建 `packages/cloud/src/websocket/cloud-agent-auth.test.ts`：≥12 个测试
  - 有效 token + 活跃订阅 → 认证成功
  - 无效 token → 拒绝
  - past_due 订阅 → 拒绝 + 错误消息
  - 超过服务器限制 → 拒绝 + 错误消息
  - tenant 不存在 → 拒绝
  - server 无 tenantId → 拒绝
**验收标准**:
- 无效 token 拒绝连接
- 订阅过期（past_due）拒绝连接并提示更新账单
- 超过服务器数量限制拒绝连接并显示限制数
- 认证成功返回完整的 server + tenant + permissions 信息
- 测试覆盖率 > 90%
**影响范围**: packages/cloud/src/websocket/cloud-agent-auth.ts, packages/cloud/src/websocket/cloud-agent-auth.test.ts
**依赖**: cloud-004（subscriptions 表，用于查询订阅状态）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:11:24

---

### [completed] 智能模型路由 — ModelRouter 实现 ✅

**ID**: cloud-009
**优先级**: P0
**模块路径**: packages/cloud/src/ai/
**功能需求**: 根据开发指南「智能模型路由 → 路由策略设计」章节，实现 `ModelRouter` 类。根据任务复杂度自动选择最优模型：危险操作（high/critical risk）→ Opus、简单查询（短对话、无命令）→ Haiku、知识库检索 → Haiku、Enterprise 可强制 Opus、默认 → Sonnet。记录路由决策到 ai_routing_logs 表。
**实现方案**:
- 创建 `packages/cloud/src/ai/model-router.ts`：
  - `ModelRouter` 类，singleton 模式
  - `selectModel(context: RoutingContext)` → 按优先级匹配规则 → 返回 ModelName
  - `logRoutingDecision(userId, context, selectedModel, actualCost)` → 插入 ai_routing_logs
  - `RoutingContext` 接口：command?, riskLevel?, conversationLength, userPlan, forceOpus?, isKnowledgeQuery?
- 创建 `packages/cloud/src/ai/model-router.test.ts`：≥15 个测试
  - critical risk → opus
  - high risk → opus
  - 短对话无命令 → haiku
  - 知识库查询 → haiku
  - enterprise + forceOpus → opus
  - 默认场景 → sonnet
  - 路由日志记录验证
**验收标准**:
- 路由决策与开发指南策略完全一致
- 路由日志正确记录到数据库
- 预期 AI 成本降低 50-60%（通过 haiku 分流简单查询）
- 测试覆盖率 > 90%
**影响范围**: packages/cloud/src/ai/model-router.ts, packages/cloud/src/ai/model-router.test.ts
**依赖**: cloud-001（ai_routing_logs 表和 ModelName 类型）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:15:40

---

### [completed] 智能模型路由 — CostTracker 成本追踪 ✅

**ID**: cloud-010
**优先级**: P0
**模块路径**: packages/cloud/src/ai/
**功能需求**: 根据开发指南「成本追踪与配额管理 → CostTracker」章节，实现实时 AI 成本追踪器。与 AIQuotaManager 配合，提供月度成本聚合、每日成本趋势、模型使用分布等数据。这是 Usage 仪表盘的数据源。
**实现方案**:
- 创建 `packages/cloud/src/ai/cost-tracker.ts`：
  - `CostTracker` 类，singleton 模式
  - `getMonthlyCost(userId)` → 聚合 ai_usage 表本月 cost 总和
  - `getDailyCosts(userId, days)` → 按天聚合成本趋势
  - `getModelDistribution(userId)` → 按模型聚合使用量（用于饼图）
  - `getMonthlyTokens(userId)` → 聚合 input/output tokens
- 创建 `packages/cloud/src/ai/cost-tracker.test.ts`：≥10 个测试
  - 月度成本聚合准确
  - 每日趋势数据正确
  - 模型分布统计正确
  - 空数据返回 0
  - 跨月数据隔离
**验收标准**:
- 月度成本精度到 6 位小数（与 ai_usage.cost 精度一致）
- 每日趋势数据按天分组，缺失日期填充 0
- 模型分布返回各模型调用次数和成本占比
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/ai/cost-tracker.ts, packages/cloud/src/ai/cost-tracker.test.ts
**依赖**: cloud-001（ai_usage 表）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:19:56

---

### [completed] Cloud AI Provider — 官方 API 配置 ✅

**ID**: cloud-011
**优先级**: P0
**模块路径**: packages/cloud/src/ai/
**功能需求**: 根据开发指南「官方 AI API 配置」章节，实现 Cloud 环境下的 AI Provider 配置。Cloud 模式下用户无需自己配置 API Key，系统使用官方 ANTHROPIC_API_KEY。集成 ModelRouter 实现自动路由，集成 CostTracker 实现成本追踪，集成 AIQuotaManager 实现配额检查。
**实现方案**:
- 创建 `packages/cloud/src/ai/cloud-provider.ts`：
  - `CloudAIProvider` 类（包装现有 AIProviderInterface）
  - `chat(messages, options)` → ModelRouter.selectModel() → 调用 AI → CostTracker.trackAICall() → 返回结果
  - 自动注入 userId/tenantId 到成本追踪
  - 配额检查前置（调用前 checkQuota）
  - 支持 streaming 响应
- 创建 `packages/cloud/src/ai/cloud-provider.test.ts`：≥10 个测试
  - 默认使用官方 API Key
  - 自动路由到正确模型
  - 成本记录写入 ai_usage
  - 配额超限拒绝调用
**验收标准**:
- Cloud 模式无需用户配置 API Key
- 每次 AI 调用自动记录成本
- 模型自动路由（不需要用户手动选择）
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/ai/cloud-provider.ts, packages/cloud/src/ai/cloud-provider.test.ts
**依赖**: cloud-002, cloud-009, cloud-010（QuotaManager, ModelRouter, CostTracker）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15 15:26:42

---

### [completed] 用户注册流程改造 — Cloud 注册 ✅

**ID**: cloud-012
**优先级**: P1
**模块路径**: packages/cloud/src/auth/
**功能需求**: 根据开发指南「P1 → 用户注册流程改造」章节，实现 Cloud 模式下的用户注册流程。与 Self-Hosted 的区别：注册时自动创建独立 Tenant，用户成为 Tenant owner，分配 Free 计划。包括邮箱唯一性验证、Tenant slug 生成（用于子域名）、欢迎邮件发送。
**实现方案**:
- 创建 `packages/cloud/src/auth/cloud-register.ts`：
  - `cloudRegister(data: { email, password, name?, companyName? })` → 验证邮箱唯一 → 创建 tenant（name, slug, plan:free） → 创建 user（tenantId, role:owner） → 更新 tenant.ownerId → 发送欢迎邮件 → 返回 { user, tenant, tokens }
  - `generateSlug(name)` → 转小写、去特殊字符、唯一性检查
  - `createDefaultTeamSettings(tenantId)` → 初始化默认设置
- 创建 `packages/cloud/src/auth/cloud-register.test.ts`：≥14 个测试
  - 正常注册 → 创建 user + tenant
  - 重复邮箱 → 400 错误
  - slug 唯一性保证（重名追加数字）
  - 返回 JWT tokens（含 tenantId）
  - companyName 作为 tenant name
  - 无 companyName 用 email 前缀
**验收标准**:
- 注册后自动创建 Tenant（plan: free, maxServers: 1, maxUsers: 1）
- Tenant slug 唯一且 URL 安全（小写字母+数字+短横线）
- 返回的 JWT 包含 tenantId
- 重复邮箱返回明确错误
- 测试覆盖率 > 90%
**影响范围**: packages/cloud/src/auth/cloud-register.ts, packages/cloud/src/auth/cloud-register.test.ts
**依赖**: 无（使用现有 user/tenant 表）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15

---

### [completed] 使用量仪表盘 — Usage API 路由 ✅

**ID**: cloud-013
**优先级**: P1
**模块路径**: packages/cloud/src/api/routes/
**功能需求**: 根据开发指南「P1 → 使用量仪表盘」章节，创建使用量统计 API。提供本月使用量摘要（AI 调用次数、成本、配额剩余）和历史趋势数据（每日成本、模型分布、Skills 执行统计）。数据按 tenant_id 隔离。
**实现方案**:
- 创建 `packages/cloud/src/api/routes/usage.ts`：
  - `GET /api/v1/usage/summary` — 本月摘要：aiCalls, aiCost, quotaRemaining, skillExecutions, serverCount
  - `GET /api/v1/usage/history?days=30` — 历史趋势：dailyCosts[], modelDistribution[], topSkills[]
  - `GET /api/v1/usage/quota` — 配额详情：plan, used, limit, resetDate
  - 所有端点使用 requireAuth + verifyTenant 中间件
  - 数据来源：ai_usage 表（成本）、skill_executions 表（Skills）、servers 表（服务器数）
- 创建 `packages/cloud/src/api/routes/usage.test.ts`：≥12 个测试
  - summary 返回正确的月度统计
  - history 返回 30 天趋势
  - 数据按 tenantId 隔离（A 租户看不到 B 租户数据）
  - free 用户显示次数配额、付费用户显示成本配额
  - 空数据返回零值（不报错）
**验收标准**:
- summary 接口返回完整的月度统计数据
- history 接口返回每日成本趋势和模型分布
- 数据严格按 tenant_id 隔离
- 响应时间 < 200ms（利用索引）
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/api/routes/usage.ts, packages/cloud/src/api/routes/usage.test.ts
**依赖**: cloud-001, cloud-010（ai_usage 表和 CostTracker）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15

---

### [completed] Dashboard 多租户隔离 — verify-tenant 中间件 ✅

**ID**: cloud-014
**优先级**: P1
**模块路径**: packages/cloud/src/api/middleware/
**功能需求**: 根据开发指南「P1 → Dashboard 多租户隔离」章节，创建 `verifyTenant()` 中间件。防止用户通过伪造 `X-Tenant-ID` header 访问其他 tenant 的数据。对比 JWT 中的 tenantId 与 header 中的 tenantId，不匹配返回 403 TENANT_MISMATCH。
**实现方案**:
- 创建 `packages/cloud/src/api/middleware/verify-tenant.ts`：
  - `verifyTenant()` 工厂函数返回 Hono 中间件
  - 从 auth context 获取 JWT tenantId
  - 从 header 获取 X-Tenant-ID
  - 不匹配 → 403 `{ error: { code: 'TENANT_MISMATCH', message: 'Tenant ID mismatch' } }`
  - 匹配或无 header → next()（无 header 时使用 JWT 中的 tenantId）
- 创建 `packages/cloud/src/api/middleware/verify-tenant.test.ts`：≥8 个测试
  - JWT tenantId 与 header 匹配 → 通过
  - JWT tenantId 与 header 不匹配 → 403
  - 无 X-Tenant-ID header → 通过（使用 JWT 值）
  - 无 auth context → 401
**验收标准**:
- 伪造 tenantId 返回 403 TENANT_MISMATCH
- 正常请求（header 匹配或无 header）正常通过
- 中间件不影响性能（纯内存比较，无 DB 查询）
- 测试覆盖率 > 90%
**影响范围**: packages/cloud/src/api/middleware/verify-tenant.ts, packages/cloud/src/api/middleware/verify-tenant.test.ts
**依赖**: 无（纯逻辑中间件）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15

---

### [completed] Skills 执行记录 — skill_executions 表与 Repository ✅

**ID**: cloud-015
**优先级**: P1
**模块路径**: packages/cloud/src/db/, packages/cloud/src/skills/
**功能需求**: 根据开发指南「数据库 Schema → Skills 执行记录」章节，定义 skill_executions 表并创建 Repository。Skills（日志巡检、安全扫描等）的执行记录需要持久化，用于使用量统计和历史回溯。
**实现方案**:
- 在 `pg-schema.ts` 中添加 `skill_executions` 表（id, userId, tenantId, serverId, skillName, status, report, duration, timestamp）
- 创建 `packages/cloud/src/skills/skill-execution-repository.ts`：
  - `create(record)` → 插入执行记录
  - `findByTenant(tenantId, options)` → 按 tenant 查询（分页、筛选）
  - `getStats(tenantId, period)` → 按 skill 聚合统计
  - singleton 模式
- 创建 `packages/cloud/src/skills/skill-execution-repository.test.ts`：≥10 个测试
**验收标准**:
- 执行记录正确持久化
- 按 tenant 隔离查询
- 统计数据支持时间范围筛选
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/db/pg-schema.ts, packages/cloud/src/skills/skill-execution-repository.ts, packages/cloud/src/skills/skill-execution-repository.test.ts
**依赖**: cloud-001（与其他新表一起更新 schema）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15

---

### [completed] AI 日志巡检 Skill — log-scanner 实现 ✅

**ID**: cloud-016
**优先级**: P1
**模块路径**: packages/cloud/src/skills/
**功能需求**: 根据开发指南「Cloud 专属 Skills → AI 日志巡检」章节，实现 `/scan-logs` Skill。AI 自动分析服务器日志（syslog, nginx error, mysql error），识别性能瓶颈、安全威胁、配置错误、容量问题。输出结构化 ScanReport（issues, trends, healthScore）。Cloud 专属：自动每小时巡检 + 趋势分析 + 主动告警。
**实现方案**:
- 创建 `packages/cloud/src/skills/log-scanner.ts`：
  - `scanLogs(serverId)` → 收集日志 → AI 分析 → 解析报告 → 存储 → 触发告警
  - `enableAutoScan(serverId)` → 定时巡检（每小时）
  - `fetchRecentLogs(serverId, options)` → 通过 Agent 收集日志
  - `ScanReport` 类型：issues[], trends[], healthScore (0-100)
  - `ScanIssue` 类型：category, severity, summary, evidence, impact, recommendation
  - AI 使用 Sonnet 模型（复杂分析任务）
- 创建 `packages/cloud/src/skills/log-scanner.test.ts`：≥12 个测试
  - 正常日志 → healthScore > 80
  - 含安全威胁日志 → 检测到 security issue
  - 含性能瓶颈日志 → 检测到 performance issue
  - high/critical → 触发告警
  - 空日志 → 健康报告
  - AI 调用失败 → 优雅降级
**验收标准**:
- 识别 4 类问题（performance, security, config, capacity）
- healthScore 0-100 合理评分
- high/critical 问题自动触发告警
- 执行记录写入 skill_executions 表
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/skills/log-scanner.ts, packages/cloud/src/skills/log-scanner.test.ts
**依赖**: cloud-011, cloud-015（CloudAIProvider, skill-execution-repository）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15

---

### [completed] AI 安全扫描 Skill — security-scanner 实现 ✅

**ID**: cloud-017
**优先级**: P1
**模块路径**: packages/cloud/src/skills/
**功能需求**: 根据开发指南「Cloud 专属 Skills → AI 安全扫描」章节，实现 `/security-audit` Skill。AI 审计服务器安全配置：已知漏洞（CVE）、配置风险（SSH/防火墙/进程）、异常行为（登录/进程/网络）。使用 Opus 模型（安全关键任务需要最强推理）。Enterprise 用户额外提供合规检查（PCI-DSS, SOC2, ISO27001）。
**实现方案**:
- 创建 `packages/cloud/src/skills/security-scanner.ts`：
  - `securityAudit(serverId, options?)` → 收集安全数据（7 个命令并行）→ Opus AI 分析 → 生成报告
  - `AuditReport` 类型：vulnerabilities[], misconfigurations[], anomalies[], autoFixScript?
  - `checkCompliance(report, standards)` → Enterprise 合规检查
  - 安全数据收集：installed packages, security patches, SSH config, firewall rules, login history, running processes, listening ports
  - AI 使用 Opus 模型（安全审计必须用最强模型）
- 创建 `packages/cloud/src/skills/security-scanner.test.ts`：≥12 个测试
  - SSH PermitRootLogin yes → 检测到 misconfiguration
  - 过期包 → 检测到 vulnerability
  - 异常登录 → 检测到 anomaly
  - Enterprise → 包含合规报告
  - 非 Enterprise → 无合规报告
  - AI 调用失败 → 优雅降级
**验收标准**:
- 检测 SSH、防火墙、CVE 等安全问题
- 生成自动加固脚本
- Enterprise 用户提供合规检查
- 使用 Opus 模型（安全审计最强推理）
- 测试覆盖率 > 85%
**影响范围**: packages/cloud/src/skills/security-scanner.ts, packages/cloud/src/skills/security-scanner.test.ts
**依赖**: cloud-011, cloud-015（CloudAIProvider, skill-execution-repository）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15

---

### [completed] Cloud 入口集成 — 导出所有模块 ✅

**ID**: cloud-018
**优先级**: P1
**模块路径**: packages/cloud/src/
**功能需求**: 更新 Cloud 包入口文件 `index.ts`，导出所有已实现的模块（AI 配额、模型路由、成本追踪、Stripe 计费、Agent 认证、Cloud 注册、中间件、Skills）。更新 `bootstrapCloud()` 函数初始化所有服务。
**实现方案**:
- 更新 `packages/cloud/src/index.ts`：
  - `bootstrapCloud()` 中初始化：PG 连接 → AIQuotaManager → ModelRouter → CostTracker
  - 导出所有公共 API：getAIQuotaManager, getModelRouter, getCostTracker, checkAIQuota, verifyTenant
  - 导出 billing 路由和 usage 路由
  - 导出 Skills（scanLogs, securityAudit）
  - 导出 cloudRegister, authenticateCloudAgent
- 更新 `packages/cloud/src/billing/index.ts`：从 placeholder 更新为正式导出
- 更新 `packages/cloud/src/analytics/index.ts`：导出 CostTracker（替代 placeholder）
**验收标准**:
- `bootstrapCloud()` 正确初始化所有服务
- 所有公共 API 可通过 `@aiinstaller/cloud` 导入
- graceful shutdown 关闭所有资源
- 类型定义完整
**影响范围**: packages/cloud/src/index.ts, packages/cloud/src/billing/index.ts, packages/cloud/src/analytics/index.ts
**依赖**: cloud-001 ~ cloud-017（所有前置任务完成后集成）
**创建时间**: 2026-02-15
**完成时间**: 2026-02-15


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
