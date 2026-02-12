# Skill 插件系统开发任务队列

> 此队列专注于 Skill 插件系统的设计与实现
> AI 自动扫描 → 发现缺失 → 设计实现 → 验证

**最后更新**: 2026-02-13 03:26:49

## 📊 统计

- **总任务数**: 28
- **待完成** (pending): 3
- **进行中** (in_progress): 0
- **已完成** (completed): 25
- **失败** (failed): 0

## 📋 任务列表

### [completed] DB Schema + Migration + SkillRepository 数据层 ✅
### [completed] runner-tools.test.ts — 工具定义构建 & 安全工具函数单元测试 ✅

**ID**: skill-023
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner-tools.ts` (222 行) 包含 `parseTimeout()`、`exceedsRiskLimit()`、`buildToolDefinitions()` 三个关键导出函数，均无任何测试覆盖。`exceedsRiskLimit` 是安全核心函数（决定命令是否被拒绝），按项目标准安全模块需 95%+ 覆盖率
**实现方案**:
创建 `runner-tools.test.ts`，覆盖以下场景:
1. **parseTimeout** (~8 tests):
   - 正常解析: "30s"→30000, "5m"→300000, "1h"→3600000
   - 边界值: "0s"→0, "999h"
   - 错误格式: "5x", "abc", "", "5", "m5" → 抛出 Error
2. **exceedsRiskLimit** (~8 tests):
   - green/yellow/red/critical/forbidden 之间的所有组合比较
   - 边界: 相同级别不超限, forbidden 永远超限
3. **buildToolDefinitions** (~8 tests):
   - 单工具: ['shell'] → 只有 shell 定义
   - 多工具: ['shell', 'read_file', 'store'] → 3 个定义
   - 全工具: 6 种工具全部声明 → 6 个完整定义
   - 验证每个工具定义的 name、input_schema 字段完整性
**验收标准**:
- 测试 ≥ 22 个，覆盖所有导出函数
- `pnpm vitest run packages/server/src/core/skill/runner-tools.test.ts` 全部通过
**影响范围**:
- `packages/server/src/core/skill/runner-tools.test.ts` (新建)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:15:46

---

### [completed] runner-executor.test.ts — 6 种工具执行器单元测试 + 安全审计验证 ✅

**ID**: skill-024
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner-executor.ts` (414 行) 实现了 `executeShell`、`executeReadFile`、`executeWriteFile`、`executeNotify`、`executeHttp`、`executeStore` 六个工具执行方法，以及 `auditShell` 审计辅助函数。这些是 Skill 命令执行的最终出口，涉及安全分级 (`classifyCommand`)、审计日志 (`getAuditLogger`)、Agent 通信 (`getTaskExecutor`)，完全无测试覆盖
**实现方案**:
创建 `runner-executor.test.ts`，Mock 外部依赖 (TaskExecutor, AuditLogger, WebhookDispatcher, SkillKVStore, Agent):
1. **executeShell** (~10 tests):
   - 正常执行: command → classifyCommand → 安全通过 → Agent 执行 → 返回 stdout
   - 安全拒绝: red 命令 + yellow max → isError=true + blocked 消息
   - forbidden 命令永远拒绝
   - 审计日志: 每次 shell 调用都记录到 auditLogger
   - Agent 未连接: 返回错误信息
2. **executeReadFile** (~3 tests): 路径正常/Agent 错误/空文件
3. **executeWriteFile** (~3 tests): 写入成功/Agent 错误/空内容
4. **executeNotify** (~3 tests): 正常分发/dispatcher 异常/缺少参数
5. **executeHttp** (~4 tests): GET/POST 成功, 超时, 非 200 响应
6. **executeStore** (~4 tests): get/set/delete/list 操作
7. **auditShell** (~2 tests): 记录格式正确, 包含 skillId/serverId/command
**验收标准**:
- 测试 ≥ 28 个，覆盖所有 6 种执行器 + 审计函数
- 安全相关测试验证 `classifyCommand()` 与 `exceedsRiskLimit()` 的联动
- `pnpm vitest run packages/server/src/core/skill/runner-executor.test.ts` 全部通过
**影响范围**:
- `packages/server/src/core/skill/runner-executor.test.ts` (新建)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:18:48

---

### [completed] Prompt 模板变量注入缺失 — engine.ts 未传递 server/skill 上下文 ✅

**ID**: skill-025
**优先级**: P0
**模块路径**: packages/server/src/core/skill/engine.ts
**当前状态**: 功能缺失 — `engine.ts:314` 调用 `resolvePromptTemplate(manifest.prompt, { input, now })` 仅传递了 `input` 和 `now` 两个变量命名空间。但 `loader.ts` 的 `resolveVariable()` 支持 4 个命名空间: `input`, `server`, `skill`, `env`。SKILL_SPEC.md 明确列出 `{{server.name}}`, `{{server.os}}`, `{{server.ip}}`, `{{skill.last_run}}`, `{{skill.last_result}}` 为可用变量。当前所有使用这些变量的 Skill prompt 将无法正确解析（变量原样保留）
**实现方案**:
1. **engine.ts execute() 方法** — 补充 `server` 和 `skill` 变量:
   - 通过 `getServerRepository().findById(serverId)` 获取 server 信息 (name, os, hostname/ip)
   - 通过 `this.repo.listExecutions(skillId, 1)` 获取上次执行记录 → `skill.last_run` (completedAt) + `skill.last_result` (result summary)
   - 传递完整 TemplateVars: `{ input, server: { name, os, ip }, skill: { last_run, last_result }, now }`
2. **可选 — env 变量**: 根据 skill manifest 的 `requires` 或配置决定是否传入 env (当前可跳过，低优先)
3. **测试**:
   - engine.test.ts 新增: 验证 resolvedPrompt 包含 server.name 替换
   - engine.test.ts 新增: 验证 skill.last_run 从上次执行记录获取
   - engine.test.ts 新增: 无上次执行时 skill.last_run 为空字符串或 "N/A"
**验收标准**:
- `resolvePromptTemplate` 接收完整 4 命名空间变量
- 官方 Skill 的 `{{server.os}}` 等模板变量能正确替换
- 测试 ≥ 4 个新增
**影响范围**:
- `packages/server/src/core/skill/engine.ts` (修改 — execute 方法)
- `packages/server/src/core/skill/engine.test.ts` (修改 — 新增变量注入测试)
**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:26:49

---

### [pending] requires_confirmation 执行确认流 — SSE 暂停/确认/恢复机制

**ID**: skill-026
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: 功能缺失 — SKILL_SPEC.md (line 147-150) 定义了 `requires_confirmation: boolean` 约束，建议 `risk_level_max >= red` 时设为 true。当前 engine.ts execute() 完全忽略此字段，直接进入 AI 循环执行。schema 已在 `@aiinstaller/shared` 中定义并验证，但后端和前端均无确认流实现
**实现方案**:
1. **engine.ts** — execute() 方法检测 `manifest.constraints.requires_confirmation`:
   - 如果为 true 且 triggerType !== 'manual'（cron/event/threshold 自动触发）: 创建 execution 记录但状态设为 `pending_confirmation`，通过 SkillEventBus 发送 `confirmation_required` 事件，等待确认
   - 如果为 true 且 triggerType === 'manual': 立即执行（手动触发已经是用户主动行为）
2. **新增 execution 状态**: `pending_confirmation` 加入 SkillExecutionStatus 枚举 (schema.ts + types)
3. **新增 API**: `POST /api/v1/skills/executions/:eid/confirm` — 确认执行，将 pending_confirmation → running
4. **新增 API**: `POST /api/v1/skills/executions/:eid/reject` — 拒绝执行，将 pending_confirmation → cancelled
5. **SkillEventBus** — 新增 `SkillConfirmationEvent` 类型
6. **Dashboard** — 待确认执行列表 + 确认/拒绝按钮 + SSE 实时通知
7. **测试**: engine 确认流 + API 端点 + Dashboard 交互
**验收标准**:
- `requires_confirmation: true` 的 Skill 自动触发时暂停等待确认
- Dashboard 显示待确认执行，用户可确认或拒绝
- 手动触发不受影响（直接执行）
- 过期未确认的执行自动取消 (可选: 30min TTL)
- 测试 ≥ 12 个
**影响范围**:
- `packages/server/src/db/schema.ts` (修改 — 新增 pending_confirmation 状态)
- `packages/server/src/core/skill/engine.ts` (修改 — 确认流逻辑)
- `packages/server/src/core/skill/skill-event-bus.ts` (修改 — 新增事件类型)
- `packages/server/src/api/routes/skills.ts` (修改 — 新增 confirm/reject 端点)
- `packages/dashboard/src/pages/Skills.tsx` (修改 — 确认 UI)
- `packages/dashboard/src/stores/skills.ts` (修改 — confirm/reject actions)
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] server_scope: 'all' / 'tagged' — 多服务器批量执行

**ID**: skill-027
**优先级**: P1
**模块路径**: packages/server/src/core/skill/engine.ts
**当前状态**: 功能缺失 — SKILL_SPEC.md (line 152-155) 定义了 `server_scope` 约束: "single" (默认), "all" (用户所有服务器), "tagged" (匹配 tag)。当前 engine.ts execute() 始终只在单个 serverId 上执行，忽略 `manifest.constraints.server_scope` 字段。TriggerManager 自动触发时也只对单个 server 执行
**实现方案**:
1. **engine.ts** — execute() 方法根据 `server_scope` 分发:
   - `'single'`: 当前逻辑不变，使用传入的 serverId
   - `'all'`: 通过 `getServerRepository().findByUser(userId)` 获取所有服务器，逐一执行 (串行，避免 Agent 并发冲突)
   - `'tagged'`: 需要 server tags 功能支持（当前 servers 表无 tags 字段，可先跳过或返回错误）
2. **执行结果聚合**: 多服务器执行返回 `SkillExecutionResult[]` 数组或包含 `perServer` 字段的聚合结果
3. **execution 记录**: 每个服务器一条 execution 记录，共享同一个 `batchId`
4. **SSE**: 按 server 分段推送进度
5. **测试**:
   - engine.test.ts: scope='all' 对 3 台 server 各执行一次
   - engine.test.ts: scope='all' 部分 server 失败不影响其余
   - engine.test.ts: scope='single' 行为不变
**验收标准**:
- `server_scope: 'all'` 的 Skill 在用户所有 enabled 服务器上依次执行
- 每台服务器的执行结果独立记录
- 单台失败不阻塞其余服务器
- 测试 ≥ 8 个
**影响范围**:
- `packages/server/src/core/skill/engine.ts` (修改 — 多服务器分发)
- `packages/server/src/core/skill/types.ts` (修改 — batchId / 聚合结果类型)
- `packages/server/src/core/skill/engine.test.ts` (修改 — 多服务器测试)
- `packages/server/src/db/repositories/skill-repository.ts` (可能修改 — batchId 字段)
**创建时间**: (自动填充)
**完成时间**: -

---

### [pending] Output Schema 验证 — AI 输出结构化校验

**ID**: skill-028
**优先级**: P1
**模块路径**: packages/server/src/core/skill/runner.ts
**当前状态**: 功能缺失 — SKILL_SPEC.md (line 210-220) 定义了 `outputs` 字段允许 Skill 声明结构化输出格式。`@aiinstaller/shared/skill-schema.ts` 已定义 `SkillOutput` Zod schema (name, type, description)。但 `runner.ts` 收集 AI 原始文本输出后直接返回 `output: string`，未尝试解析 AI 输出为结构化数据，也未校验是否满足 manifest 声明的 outputs
**实现方案**:
1. **runner.ts** — run() 方法最后阶段新增 output 解析:

### [completed] SkillRepository.findAllEnabled() — 启动时加载已启用 Skill 的触发器 ✅

**ID**: skill-013
**优先级**: P0
**模块路径**: packages/server/src/db/repositories/skill-repository.ts
**当前状态**: 功能缺失 — `TriggerManager.findAllEnabledSkills()` (trigger-manager.ts:408-414) 使用 duck-typing 检测 `repo['findAllEnabled']`，但 `SkillRepository` 接口和两个实现类 (`DrizzleSkillRepository`, `InMemorySkillRepository`) 都没有定义 `findAllEnabled()` 方法。导致服务器重启后，已启用 Skill 的 cron/event/threshold 触发器不会被重新注册，只能通过手动重新启用来恢复
**实现方案**:

1. **SkillRepository 接口** — 新增方法签名:
   - `findAllEnabled(): Promise<InstalledSkill[]>` — 返回所有 `status === 'enabled'` 的 Skill (跨用户)
2. **DrizzleSkillRepository** — 实现:
   - `SELECT * FROM installed_skills WHERE status = 'enabled' ORDER BY created_at DESC`
   - 使用 Drizzle: `db.select().from(installedSkills).where(eq(installedSkills.status, 'enabled')).all()`
3. **InMemorySkillRepository** — 实现:
   - `this.skills.filter(s => s.status === 'enabled')`
4. **TriggerManager** — 移除 duck-typing hack (trigger-manager.ts:408-414):
   - 直接调用 `this.repo.findAllEnabled()` (接口类型保证方法存在)
5. **测试**:
   - DrizzleSkillRepository: 测试 findAllEnabled 只返回 enabled 状态
   - InMemorySkillRepository: 同上
   - TriggerManager: 测试 start() 时从 DB 加载已启用的 Skill 并注册触发器

**验收标准**:
- 服务器重启后，所有 `status=enabled` 的 Skill 的触发器被自动恢复
- `TriggerManager.start()` 不再使用 duck-typing 检测
- 测试 ≥ 6 个新增

**影响范围**:
- `packages/server/src/db/repositories/skill-repository.ts` (修改 — 接口 + 两个实现)
- `packages/server/src/core/skill/trigger-manager.ts` (修改 — 移除 duck-typing)
- `packages/server/src/core/skill/trigger-manager.test.ts` (修改 — 新增 startup 加载测试)
- `packages/server/src/db/repositories/skill-repository.test.ts` (如存在则修改)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 01:55:03

---

### [completed] Store 工具定义缺少 `list` action — AI 无法使用 KV 列表功能 ✅

**ID**: skill-014
**优先级**: P0
**模块路径**: packages/server/src/core/skill/runner-tools.ts
**当前状态**: 功能缺失 — `buildToolDefinitions()` 中 `store` 工具的 `action` enum 为 `['get', 'set', 'delete']` (runner-tools.ts:203)，但 `runner.ts:645-648` 的 `executeStore()` 实现了 `list` action。AI 不知道 `list` 操作存在，因此永远不会调用它。规范文档 (SKILL_SPEC.md) 要求 store 工具支持 get/set/delete/list 四种操作
**实现方案**:

1. **runner-tools.ts** — 修改 `buildToolDefinitions()` 中 store 工具:
   - `action.enum`: `['get', 'set', 'delete']` → `['get', 'set', 'delete', 'list']`
   - 更新 `action.description`: 说明 `list` 返回该 Skill 所有键值对
   - `list` 操作不需要 `key` 参数，但 `key` 仍标记为 required — 需改为 optional 或允许 `list` 忽略 `key`
   - 最佳方案: 将 `required` 改为 `['action']`，`key` 和 `value` 都变为 optional；在 runner.ts 中对 `get`/`set`/`delete` 做参数存在性检查
2. **runner.ts** — 在 `executeStore()` 中增加 `key` 缺失检查:
   - `get`/`delete`: 如果 `key` 为空字符串或 undefined → 返回错误
   - `list`: 忽略 `key` 参数 (已实现)
3. **测试**:
   - runner-tools.test.ts (如存在): 验证 store 工具定义包含 `list`
   - runner.test.ts: 新增 `list` 操作测试

**验收标准**:
- AI 可以成功调用 `store` 工具的 `list` action
- `key` 对 `list` 操作不再是必填
- `get`/`set`/`delete` 仍要求 `key`
- 测试覆盖所有 4 种 store 操作

**影响范围**:
- `packages/server/src/core/skill/runner-tools.ts` (修改 — enum + required)
- `packages/server/src/core/skill/runner.ts` (修改 — 参数校验)
- `packages/server/src/core/skill/runner.test.ts` (修改 — 新增 list 测试)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:02:58

---

### [completed] Dashboard Skill 执行按钮无功能 — onExecute 为空回调 ✅

**ID**: skill-015
**优先级**: P1
**模块路径**: packages/dashboard/src/pages/Skills.tsx
**当前状态**: 功能缺失 — `Skills.tsx:148` 中 `onExecute={() => {}}` 传递空回调，点击 SkillCard 的执行按钮 (⚡ Zap icon) 无任何效果。缺少服务器选择器和执行触发流程。Store 中已有 `executeSkill(id, serverId, config)` 方法和 `startExecutionStream(executionId)` 方法，但页面未集成
**实现方案**:

1. **Skills.tsx** — 添加执行流程:
   - 新增 `executeTarget` state: `useState<InstalledSkill | null>(null)`
   - 点击执行 → `setExecuteTarget(skill)` → 打开执行 Dialog
   - 执行 Dialog 内容:
     - 服务器选择器: 下拉列表从 servers store 获取在线服务器
     - "执行" 确认按钮 → `executeSkill(skill.id, selectedServerId)` → 获取 executionId
     - 执行后展示 `ExecutionStream` 组件 (实时进度)
   - 替换 `onExecute={() => {}}` 为 `onExecute={setExecuteTarget}`
2. **i18n** — en.json + zh.json 新增:
   - `skills.executeSkill`: "Execute Skill" / "执行技能"
   - `skills.selectServer`: "Select a server" / "选择服务器"
   - `skills.noServers`: "No servers available" / "无可用服务器"
   - `skills.executing`: "Executing..." / "执行中..."
3. **测试**:
   - Skills.test.tsx: 新增执行按钮点击 → Dialog 打开 → 服务器选择 → 触发执行

**验收标准**:
- 点击执行按钮弹出 Dialog，包含服务器选择器
- 选择服务器后点击确认，触发 `executeSkill()` API 调用
- 执行中显示实时 SSE 进度流 (`ExecutionStream` 组件)
- 执行完成后可查看结果
- 测试 ≥ 3 个新增

**影响范围**:
- `packages/dashboard/src/pages/Skills.tsx` (修改 — 执行流程)
- `packages/dashboard/src/pages/Skills.test.tsx` (修改 — 新增测试)
- `packages/dashboard/src/i18n/locales/en.json` (修改 — 新增 keys)
- `packages/dashboard/src/i18n/locales/zh.json` (修改 — 新增 keys)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:10:34

---

### [completed] configureSkill store 盲写 status='configured' — 覆盖已启用/暂停状态 ✅

**ID**: skill-016
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/skills.ts
**当前状态**: Bug — `skills.ts:113` 在 `configureSkill` 成功后强制将 status 设为 `'configured'`，即使 Skill 原本是 `'enabled'` 或 `'paused'` 状态。服务端 `engine.ts:196-198` 只在 `status === 'installed'` 时才自动转为 configured，其他状态保持不变。前端乐观更新与服务端行为不一致，导致 UI 显示错误状态
**实现方案**:

1. **stores/skills.ts** — 修改 `configureSkill`:
   - 移除盲写 `status: 'configured' as SkillStatus` 逻辑
   - 改为: 只在 `s.status === 'installed'` 时将 status 更新为 `'configured'`
   - 其他状态保持原样: `s.id === id ? { ...s, config, ...(s.status === 'installed' ? { status: 'configured' as SkillStatus } : {}) } : s`
2. **测试**:
   - skills.test.ts: 新增测试 — configureSkill 对 enabled/paused 状态的 Skill 不改变 status

**验收标准**:
- 配置已启用的 Skill 后，UI 仍显示 "Enabled" 而非 "Configured"
- 配置已安装 (installed) 的 Skill 后，UI 正确显示 "Configured"
- 测试 ≥ 2 个新增

**影响范围**:
- `packages/dashboard/src/stores/skills.ts` (修改 — 条件状态更新)
- `packages/dashboard/src/stores/skills.test.ts` (修改 — 新增测试)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:12:26

---

### [completed] runner.ts 超 500 行限制 — 提取工具执行方法到独立模块 ✅

**ID**: skill-017
**优先级**: P2
**模块路径**: packages/server/src/core/skill/runner.ts
**当前状态**: 需要改进 — `runner.ts` 当前 677 行，超过项目标准的 500 行软限制。文件包含 SkillRunner 核心循环 + 6 种工具执行方法 (shell/read_file/write_file/notify/http/store) + 审计方法 + helper 方法。工具执行逻辑可独立提取
**实现方案**:

1. **新建 `runner-executor.ts`** (~250 行):
   - 提取 6 个 `execute*` 方法 + `auditShell` 方法为独立类 `SkillToolExecutor`:
     - `executeShell()`, `executeReadFile()`, `executeWriteFile()`, `executeNotify()`, `executeHttp()`, `executeStore()`
     - `auditShell()` 辅助方法
   - 构造参数: 接收所需依赖 (taskExecutor, auditLogger, webhookDispatcher 等)
   - 导出 `SkillToolExecutor` 类
2. **修改 `runner.ts`** (~350 行):
   - 移除工具执行方法，改为实例化 `SkillToolExecutor` 并调用
   - 保留核心 agentic loop 逻辑
3. **测试**:
   - 现有 runner.test.ts 无需大改 (接口不变)
   - 可选: 新增 runner-executor.test.ts 对工具执行方法做独立单元测试

**验收标准**:
- `runner.ts` 降至 ≤ 500 行
- `runner-executor.ts` ≤ 300 行
- 所有现有 runner.test.ts 测试继续通过
- 无行为变化，纯重构

**影响范围**:
- `packages/server/src/core/skill/runner.ts` (修改 — 拆分)
- `packages/server/src/core/skill/runner-executor.ts` (新建)
- `packages/server/src/core/skill/runner.test.ts` (可能微调 import)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:17:07

---

### [completed] Skill 执行 E2E 集成测试 — 覆盖完整生命周期 ✅

**ID**: skill-018
**优先级**: P2
**模块路径**: tests/ 或 packages/server/src/core/skill/
**当前状态**: 功能缺失 — 现有测试全部为单元测试 (mock AI provider、mock executor)。缺少验证完整 install → configure → enable → manual execute → verify execution result 的集成测试。特别是以下集成点未被测试覆盖:
  - SkillEngine + SkillRunner + TriggerManager 协同
  - RBAC 权限在 skill 路由上的端到端验证
  - SSE 事件流从 SkillRunner → SkillEventBus → SSE endpoint 的完整链路
**实现方案**:

1. **skill-integration.test.ts** (~300 行):
   - 使用 InMemory repositories + Mock AI Provider
   - 测试完整生命周期:
     - 安装 → 验证 DB 持久化
     - 配置 → 验证状态自动转换 (installed → configured)
     - 启用 → 验证 TriggerManager 注册触发器
     - 手动执行 → Mock AI 返回 tool_use → 验证工具调用链
     - 暂停 → 验证 TriggerManager 注销触发器
     - 卸载 → 验证 DB 清理 + 关联执行记录级联删除
   - 测试 SSE 事件流:
     - 启动执行 → 订阅 SkillEventBus → 验证 step/log/completed 事件序列
   - 测试 RBAC 端到端:
     - member 角色只能 view，不能 manage/execute
     - admin 角色可以 manage + execute
   - 测试错误恢复:
     - Skill manifest 损坏 → 执行失败 → status 设为 error
     - 执行超时 → 正确记录 timeout 状态

**验收标准**:
- 完整的 install→configure→enable→execute→result 链路覆盖
- SSE 事件流验证
- RBAC 权限验证
- 测试 ≥ 15 个

**影响范围**:
- `packages/server/src/core/skill/skill-integration.test.ts` (新建)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:28:39

---

### [completed] Skill 输入定义从 Manifest 获取 — 替代 config key 推断 ✅

**ID**: skill-019
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Skills.tsx + packages/server/src/api/routes/skills.ts
**当前状态**: 功能缺失 — `Skills.tsx:426-441` 中 `getSkillInputs()` 从 skill.config 的 key 推断输入类型，无法获取 manifest 中定义的真实 `inputs[]` (名称、类型、描述、默认值、required、enum options)。例如一个 enum 类型的 input 会被误推断为 string。API 端的 GET /skills 和 GET /skills/:id 只返回 DB 数据，不包含 manifest 中的 inputs 定义
**实现方案**:

1. **Server API** — GET /skills 响应中附带 manifest inputs:
   - `engine.listInstalled()` 返回结果时，对每个 skill 尝试加载 manifest 并提取 `inputs[]`
   - 或新增专用端点 `GET /skills/:id/manifest` 返回 manifest 的 inputs + triggers + tools
   - 推荐方案: 在 install 时将 manifest 的 inputs JSON 保存到 `installed_skills.config` 的 `_inputs` 字段，或新增 `manifest_inputs` 列
2. **Dashboard** — `getSkillInputs()` 优先使用 manifest inputs:
   - API 返回的 skill 包含 `inputs?: SkillInputDef[]` 字段
   - 配置 Modal 使用 manifest inputs 生成表单 (支持 enum 下拉、boolean 开关、数字输入等)
   - 回退: 无 inputs 时仍用 config key 推断 (向后兼容)
3. **types/skill.ts** — InstalledSkill 类型新增 `inputs?: SkillInputDef[]`

**验收标准**:
- 配置 Modal 能正确渲染 enum 类型为下拉选择器
- 配置 Modal 能显示 input 的 description 和 default 值
- 配置 Modal 对 required input 做必填验证
- 测试 ≥ 5 个

**影响范围**:
- `packages/server/src/api/routes/skills.ts` (修改 — 返回 inputs)
- `packages/server/src/core/skill/engine.ts` (修改 — 查询时附带 manifest inputs)
- `packages/dashboard/src/pages/Skills.tsx` (修改 — 使用 manifest inputs)
- `packages/dashboard/src/types/skill.ts` (修改 — InstalledSkill 新增字段)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:35:47

---

### [completed] Webhook 事件集成 — 系统事件自动触发 Skill ✅

**ID**: skill-020
**优先级**: P2
**模块路径**: packages/server/src/core/skill/trigger-manager.ts + packages/server/src/core/webhook/dispatcher.ts
**当前状态**: 功能缺失 — TriggerManager 的 event trigger 注册了事件类型 (如 `alert.triggered`, `server.offline`)，但 `handleEvent()` 方法仅被 SkillEngine 在 `skill.completed`/`skill.failed` 时调用。WebhookDispatcher 分发 5 种系统事件 (`task.completed`, `alert.triggered`, `server.offline`, `operation.failed`, `agent.disconnected`) 时不通知 TriggerManager。系统事件无法触发 Skill 执行
**实现方案**:

1. **集成方式** (低耦合):
   - 在 `index.ts` 的 `startServer()` 中注册事件桥接:
     - `getWebhookDispatcher().onDispatch((event) => getTriggerManager().handleEvent(event.type, event.data))`
   - 或在 TriggerManager.start() 中订阅 WebhookDispatcher 的 EventEmitter
   - 推荐方案: WebhookDispatcher 已有 `dispatch()` 方法 → 在 dispatch 成功后 emit 一个本地事件 → TriggerManager 订阅
2. **WebhookDispatcher** — 新增 EventEmitter 或回调:
   - 在 `dispatch()` 方法末尾发布事件: `this.emitter.emit('dispatched', { type, data })`
   - 或添加 `onDispatch(callback)` 注册方法
3. **TriggerManager** — 在 `start()` 中订阅 dispatcher 事件
4. **测试**:
   - WebhookDispatcher dispatch → TriggerManager handleEvent 被调用
   - `alert.triggered` 事件 → 匹配 event trigger 的 Skill 被执行
   - 不匹配的事件类型不触发

**验收标准**:
- `alert.triggered` 等系统事件能自动触发配置了对应 event trigger 的 Skill
- WebhookDispatcher 无需知道 SkillEngine/TriggerManager 的存在 (反转依赖)
- 测试 ≥ 6 个

**影响范围**:
- `packages/server/src/core/webhook/dispatcher.ts` (修改 — 新增事件发射)
- `packages/server/src/core/skill/trigger-manager.ts` (修改 — 订阅 dispatcher)
- `packages/server/src/index.ts` (修改 — 注册桥接)
- 测试文件 (新增/修改)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:43:07

---

### [completed] Skill manifest_inputs 持久化 — 安装时保存输入定义到 DB ✅

**ID**: skill-021
**优先级**: P3
**模块路径**: packages/server/src/db/schema.ts + packages/server/src/core/skill/engine.ts
**当前状态**: 功能缺失 — `installed_skills` 表没有存储 manifest 中的 `inputs[]` 定义。每次需要 inputs 信息时必须从磁盘加载 `skill.yaml` 并解析。如果 Skill 目录被删除或损坏，inputs 信息丢失。Dashboard 配置 Modal 无法获取正确的输入类型定义 (依赖 skill-019)
**实现方案**:

1. **DB Schema** — `installed_skills` 表新增列:
   - `manifest_inputs TEXT` — JSON 序列化的 `SkillManifest.inputs[]`
   - 或重用 `config` 列的 `_manifest` 子键 (不推荐，混淆用户配置和元数据)
2. **Migration** — `0011_skill_manifest_inputs.sql`:
   - `ALTER TABLE installed_skills ADD COLUMN manifest_inputs TEXT`
3. **engine.ts** — `install()` 方法:
   - 解析 manifest 后，将 `manifest.inputs` JSON 序列化保存到 `manifest_inputs` 列
4. **SkillRepository** — 更新 `install()` 输入类型:
   - `InstallSkillInput` 新增 `manifestInputs?: unknown[]`
5. **API 返回** — GET /skills 的响应中包含 `manifestInputs` 字段

**验收标准**:
- 安装 Skill 后 DB 持久化了 inputs 定义
- API 返回 InstalledSkill 包含 manifestInputs
- 即使磁盘 skill.yaml 损坏，仍可从 DB 获取 inputs 定义
- Migration 平滑执行 (nullable 列)

**影响范围**:
- `packages/server/src/db/schema.ts` (修改)
- `packages/server/src/db/migrations/0011_skill_manifest_inputs.sql` (新建)
- `packages/server/src/db/connection.ts` (修改 — createTables)
- `packages/server/src/db/repositories/skill-repository.ts` (修改)
- `packages/server/src/core/skill/engine.ts` (修改)
- `packages/server/src/core/skill/types.ts` (修改 — InstalledSkill 新增字段)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 02:54:50

---

### [completed] Skill 执行历史增强 — 执行详情页 + 重新执行 ✅

**ID**: skill-022
**优先级**: P3
**模块路径**: packages/dashboard/src/components/skill/
**当前状态**: 功能缺失 — `ExecutionHistory.tsx` 只显示执行列表 (时间、状态、步数、耗时)，无法展开查看单条执行的详细结果 (AI 输出、工具调用记录、错误信息)。API 已有 `GET /skills/:id/executions/:eid` 返回执行详情，但 Dashboard 未调用。也无法从历史中重新执行 Skill
**实现方案**:

1. **ExecutionDetail.tsx** (~150 行):
   - 执行详情展示: AI 输出文本、工具调用列表 (名称、输入、结果、耗时)、错误列表
   - 工具调用折叠/展开
   - "重新执行" 按钮 → 使用相同的 skillId + serverId 触发新执行
2. **ExecutionHistory.tsx** — 修改:
   - 点击执行记录行 → 展开/切换到 ExecutionDetail 视图
   - 或使用 Dialog 展示详情
3. **stores/skills.ts** — 新增:
   - `fetchExecutionDetail(skillId, executionId)` → `GET /skills/:id/executions/:eid`
   - `selectedExecution: SkillExecution | null` state
4. **i18n** — 新增 keys: executionDetail, reExecute, toolCalls, aiOutput, errors
5. **测试**: ≥ 4 个 (详情加载、重新执行、错误处理)

**验收标准**:
- 点击历史记录可查看执行详情 (AI 输出 + 工具调用记录)
- 详情页有"重新执行"按钮
- 测试 ≥ 4 个

**影响范围**:
- `packages/dashboard/src/components/skill/ExecutionDetail.tsx` (新建)
- `packages/dashboard/src/components/skill/ExecutionHistory.tsx` (修改)
- `packages/dashboard/src/stores/skills.ts` (修改)
- `packages/dashboard/src/i18n/locales/en.json` (修改)
- `packages/dashboard/src/i18n/locales/zh.json` (修改)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 03:03:59

### [completed] Skill KV Store — 每个 Skill 的持久化存储 API ✅

**ID**: skill-007
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner.ts:570-574` 中 `store` 工具调用返回占位错误 `"KV store not yet implemented (skill-007)"`；`skill_store` 表已在 schema.ts 中定义并有迁移
**实现方案**:

1. **store.ts** (~120 行):
   - `SkillKVStore` 类: 封装对 `skill_store` 表的 CRUD 操作
   - 方法: `get(skillId, key): Promise<string | null>`, `set(skillId, key, value): Promise<void>`, `delete(skillId, key): Promise<void>`, `list(skillId): Promise<Record<string, string>>`
   - 值大小限制: 单个 value ≤ 1MB (规范要求)
   - 通过 `getSkillRepository()` 或直接使用 Drizzle 查询 `skillStore` 表
   - 单例: `getSkillKVStore()` / `setSkillKVStore()` / `_resetSkillKVStore()`
2. **更新 runner.ts** — `handleStoreTool()` 方法:
   - 替换占位逻辑，改为调用 `getSkillKVStore()` 执行真实 get/set/delete/list 操作
   - action: `get` → 读取, `set` → 写入, `delete` → 删除, `list` → 列出所有 key
3. **store.test.ts** (~150 行):
   - 测试 get/set/delete/list 基本 CRUD 操作
   - 测试 value 大小超限拒绝 (>1MB)
   - 测试 key 不存在返回 null
   - 测试多个 skill 之间的数据隔离
   - 测试 InMemory 实现 (用于 runner 测试)

**验收标准**:
- `store` 工具能在 runner.ts 中正常执行 get/set/delete/list 4 种操作
- 数据持久化到 SQLite `skill_store` 表
- 单值 ≤ 1MB 限制生效
- 不同 skillId 之间数据隔离
- 测试 ≥ 12 个

**影响范围**:
- `packages/server/src/core/skill/store.ts` (新建)
- `packages/server/src/core/skill/store.test.ts` (新建)
- `packages/server/src/core/skill/runner.ts` (修改 — 接入真实 KV store)

**创建时间**: (自动填充)
**完成时间**: 2026-02-12 23:52:54

---

### [completed] TriggerManager — Cron/Event/Threshold 触发调度 ✅

**ID**: skill-006
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `engine.ts:80-85` 中 `start()` 方法为空壳 (注释 "TriggerManager — deferred to future task")；当前仅支持手动执行
**实现方案**:

1. **trigger-manager.ts** (~350 行):
   - `TriggerManager` 类: 管理所有已启用 Skill 的自动触发器
   - **Cron 触发**: 使用 `node-cron` 库 (需新增依赖)
     - `registerCron(skillId, cronExpression, serverId)` — 注册 cron 定时任务
     - `unregisterCron(skillId)` — 停止并移除 cron 任务
     - cron 回调: `SkillEngine.execute(skillId, serverId, userId, 'cron')`
   - **Event 触发**: 订阅 WebhookDispatcher 事件
     - `registerEvent(skillId, eventTypes: string[])` — 监听 task.completed / alert.triggered / server.offline 等事件
     - 事件匹配时调用 `SkillEngine.execute()` with `triggerType='event'`
     - 通过 EventEmitter 或直接在 webhook dispatch 流程中注入 hook
   - **Threshold 触发**: 监听 MetricsBus 指标
     - `registerThreshold(skillId, metric, operator, value)` — 注册阈值监控
     - 订阅 `getMetricsBus()` 事件，当 cpu.usage > 90 等条件满足时触发
     - 防抖: 同一 Skill 同一 server 至少间隔 5 分钟才能再次触发
   - 生命周期:
     - `start()` — 从 DB 读取所有 enabled 的 Skill，注册各类触发器
     - `stop()` — 清除所有 cron 任务、取消事件订阅、停止阈值监控
     - `registerSkill(skill, manifest)` — 安装/启用时调用
     - `unregisterSkill(skillId)` — 卸载/暂停时调用
2. **更新 engine.ts**:
   - `start()` → 创建 TriggerManager 实例并调用 `triggerManager.start()`
   - `stop()` → 调用 `triggerManager.stop()`
   - `install()` → 若已 enabled 则 `triggerManager.registerSkill()`
   - `updateStatus('enabled')` → `triggerManager.registerSkill()`
   - `updateStatus('paused')` / `uninstall()` → `triggerManager.unregisterSkill()`
3. **trigger-manager.test.ts** (~300 行):
   - Cron: 注册 → 触发 → 执行回调验证
   - Event: 事件发布 → 匹配 → 触发执行验证
   - Threshold: 指标超限 → 触发 + 防抖逻辑验证
   - 生命周期: start 加载已有 Skill / stop 清理所有资源
   - 注册/反注册: Skill 状态变更正确更新触发器
4. **安装依赖**: `pnpm --filter @aiinstaller/server add node-cron && pnpm --filter @aiinstaller/server add -D @types/node-cron`

**验收标准**:
- Cron 表达式 (如 `0 8 * * *`) 能定时触发 Skill 执行
- Event 触发 (如 `alert.triggered`) 能自动执行对应 Skill
- Threshold 触发 (如 `cpu.usage > 90`) 能通过 MetricsBus 感知并触发
- 防抖机制防止同一 Skill 频繁触发 (≥5 分钟间隔)
- engine.ts 的 start/stop/install/updateStatus 正确集成 TriggerManager
- 测试 ≥ 20 个

**影响范围**:
- `packages/server/src/core/skill/trigger-manager.ts` (新建)
- `packages/server/src/core/skill/trigger-manager.test.ts` (新建)
- `packages/server/src/core/skill/engine.ts` (修改 — 集成 TriggerManager)
- `packages/server/package.json` (新增 node-cron 依赖)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:06:54

---

### [completed] Dashboard — 前端类型 + Zustand Store + API 集成 ✅

**ID**: skill-008
**优先级**: P3
**模块路径**: packages/dashboard/src/
**当前状态**: 全部不存在 — `pages/Skills.tsx`, `stores/skills.ts`, `types/skill.ts` 均未创建；`App.tsx` 和侧边栏无 Skill 相关路由或导航项
**实现方案**:

1. **types/skill.ts** (~60 行):
   - `InstalledSkill`: id, userId, name, displayName, version, source, status, config, createdAt, updatedAt
   - `SkillExecution`: id, skillId, serverId, triggerType, status, startedAt, completedAt, result, stepsExecuted, duration
   - `AvailableSkill`: name, displayName, version, description, author, tags, source, installed
   - `SkillConfig`: Record<string, unknown>
   - `SkillStatus`: 'installed' | 'configured' | 'enabled' | 'paused' | 'error'
2. **stores/skills.ts** (~180 行):
   - Zustand store: `useSkillStore`
   - 状态: `skills: InstalledSkill[]`, `available: AvailableSkill[]`, `executions: SkillExecution[]`, `loading: boolean`, `error: string | null`
   - Actions:
     - `fetchSkills()` → `GET /api/v1/skills`
     - `fetchAvailable()` → `GET /api/v1/skills/available`
     - `installSkill(name, source)` → `POST /api/v1/skills/install`
     - `uninstallSkill(id)` → `DELETE /api/v1/skills/:id`
     - `configureSkill(id, config)` → `PUT /api/v1/skills/:id/config`
     - `updateStatus(id, status)` → `PUT /api/v1/skills/:id/status`
     - `executeSkill(id, serverId)` → `POST /api/v1/skills/:id/execute`
     - `fetchExecutions(id)` → `GET /api/v1/skills/:id/executions`
   - 使用 `apiRequest()` 统一 HTTP 调用 (自动 401 刷新)
3. **更新 App.tsx** — 添加 `/skills` 路由
4. **更新 Sidebar** — 添加 Skills 导航项 (Puzzle 图标，位于 Webhooks 和 Settings 之间)
5. **stores/skills.test.ts** (~120 行):
   - Mock `apiRequest`，测试所有 8 个 actions 的成功/失败路径
   - 测试 loading 状态变化
   - 测试 error 处理
   - 测试 ≥ 10 个

**验收标准**:
- TypeScript 类型完整覆盖 API 响应结构
- Store 所有 actions 调用正确的 API 端点
- 侧边栏出现 Skills 导航项，点击跳转 `/skills`
- `pnpm --filter @aiinstaller/dashboard build` 无类型错误
- 测试 ≥ 10 个

**影响范围**:
- `packages/dashboard/src/types/skill.ts` (新建)
- `packages/dashboard/src/stores/skills.ts` (新建)
- `packages/dashboard/src/stores/skills.test.ts` (新建)
- `packages/dashboard/src/App.tsx` (修改 — 添加路由)
- `packages/dashboard/src/components/Sidebar.tsx` 或类似 (修改 — 添加导航)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:13:58

---

### [completed] Dashboard — Skills 管理页面 + UI 组件 ✅

**ID**: skill-009
**优先级**: P3
**模块路径**: packages/dashboard/src/pages/ + packages/dashboard/src/components/skill/
**当前状态**: 全部不存在 — 依赖 skill-008 (类型 + Store) 完成后开发
**实现方案**:

1. **pages/Skills.tsx** (~250 行):
   - 顶部: 标题 + "安装 Skill" 按钮
   - Tab 切换: "已安装" / "可用" (marketplace)
   - 已安装 Tab: SkillCard 列表 (显示名称、版本、状态、操作按钮)
   - 可用 Tab: AvailableSkillCard 列表 (显示名称、描述、标签、安装按钮)
   - 空状态: 无 Skill 时引导用户安装
2. **components/skill/SkillCard.tsx** (~120 行):
   - 卡片展示: icon + 名称 + 版本 + source badge + status badge
   - 操作: 启用/暂停 toggle, 配置按钮, 执行按钮, 卸载按钮
   - 状态颜色: enabled=绿, paused=灰, error=红, installed/configured=蓝
3. **components/skill/SkillConfigModal.tsx** (~150 行):
   - Modal 弹窗: 展示 Skill 的 inputs 字段
   - 动态表单生成: 根据 input.type (string/number/boolean/select/string[]) 渲染对应控件
   - 必填/可选标记、默认值填充
   - 提交 → `configureSkill(id, config)`
4. **components/skill/ExecutionHistory.tsx** (~100 行):
   - 执行历史列表: 时间、触发类型、状态、耗时、步数
   - 状态 badge: success=绿, failed=红, running=蓝 动画, timeout=黄
   - 点击展开查看执行详情 (result JSON)
5. **pages/Skills.test.tsx** (~150 行):
   - 渲染测试: 已安装列表、可用列表、空状态
   - 交互测试: 安装/卸载/启用/暂停按钮点击
   - Modal 测试: 配置表单提交
   - 测试 ≥ 12 个

**验收标准**:
- Skills 页面展示已安装 Skill 列表和可用 Skill marketplace
- 能完成安装 → 配置 → 启用 → 执行 → 查看历史的完整 UI 流程
- 配置 Modal 能根据 Skill 的 inputs 定义动态生成表单
- 响应式布局 (移动端友好)
- Tailwind CSS 风格一致
- 测试 ≥ 12 个

**影响范围**:
- `packages/dashboard/src/pages/Skills.tsx` (新建)
- `packages/dashboard/src/pages/Skills.test.tsx` (新建)
- `packages/dashboard/src/components/skill/SkillCard.tsx` (新建)
- `packages/dashboard/src/components/skill/SkillConfigModal.tsx` (新建)
- `packages/dashboard/src/components/skill/ExecutionHistory.tsx` (新建)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:23:27

---

### [completed] SSE 推送 — Skill 执行实时进度流 ✅

**ID**: skill-010
**优先级**: P3
**模块路径**: packages/server/src/core/skill/ + packages/server/src/api/routes/ + packages/dashboard/src/
**当前状态**: 不存在 — Skill 执行目前是同步等待返回最终结果，无中间进度推送。已有 MetricsBus SSE 可参考
**实现方案**:

1. **core/skill/skill-event-bus.ts** (~60 行):
   - `SkillEventBus` — EventEmitter 封装，发布 Skill 执行进度事件
   - 事件类型: `step` (工具调用进度), `log` (AI 思考日志), `completed` (执行完成), `error` (错误)
   - 单例: `getSkillEventBus()` / `_resetSkillEventBus()`
   - 频道: `skill:${executionId}` — 每次执行一个独立事件流
2. **更新 runner.ts** — 在 agentic loop 的关键节点发布事件:
   - 工具调用前: `emit('step', { tool, input })` — 通知前端 "正在执行 shell: ls -la"
   - 工具调用后: `emit('step', { tool, result, success })` — 通知结果
   - AI 思考: `emit('log', { text })` — AI 的文本输出
   - 完成/超时: `emit('completed', { result })` 或 `emit('error', { message })`
3. **api/routes/skills.ts** — 新增 SSE 端点:
   - `GET /api/v1/skills/:id/executions/:eid/stream` — SSE 连接
   - 订阅 `SkillEventBus` 对应 executionId 的事件
   - 中间件: requireAuth + requirePermission('skill:view')
4. **Dashboard 集成**:
   - `api/sse.ts` 新增 `createSkillExecutionSSE(executionId)` 方法
   - `stores/skills.ts` 新增 `streamExecution(executionId)` 方法
   - `components/skill/ExecutionStream.tsx` (~100 行) — 实时进度 UI:
     - 步骤列表: 每步显示工具名、输入、结果、状态图标
     - AI 思考文本实时追加
     - 完成/失败状态自动切换
5. **测试**:
   - `skill-event-bus.test.ts` (~50 行): emit/subscribe/unsubscribe
   - SSE 端点测试 (整合到 skills.test.ts): 连接 → 收到事件 → 断开

**验收标准**:
- 手动执行 Skill 后，前端实时显示每一步工具调用的进度
- SSE 连接自动重连 (参考 MetricsSSE 的 exponential backoff)
- 执行完成后 SSE 自动关闭
- 事件总线不泄漏 (执行完成后清理 listener)
- 测试 ≥ 8 个

**影响范围**:
- `packages/server/src/core/skill/skill-event-bus.ts` (新建)
- `packages/server/src/core/skill/skill-event-bus.test.ts` (新建)
- `packages/server/src/core/skill/runner.ts` (修改 — 接入事件发布)
- `packages/server/src/api/routes/skills.ts` (修改 — 新增 SSE 端点)
- `packages/dashboard/src/api/sse.ts` (修改 — 新增 Skill SSE)
- `packages/dashboard/src/stores/skills.ts` (修改 — 新增 stream 方法)
- `packages/dashboard/src/components/skill/ExecutionStream.tsx` (新建)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:33:10

---

### [completed] 社区 Skill 安装 — 从 Git URL 克隆 + 安全扫描 ✅

**ID**: skill-011
**优先级**: P4
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — 当前仅支持从本地目录安装 (`engine.ts:install()` 接受 `skillDir` 参数为本地路径)；`POST /api/v1/skills/install` 只接收 `{ name, source }`，无 Git URL 字段
**实现方案**:

1. **core/skill/git-installer.ts** (~120 行):
   - `installFromGitUrl(url: string, targetDir: string): Promise<string>` — 执行 `git clone --depth 1` 到 `skills/community/<name>/`
   - URL 验证: 仅允许 `https://` 协议 (拒绝 `git://`, `ssh://`)
   - 目录命名: 从 URL 提取仓库名 (如 `https://github.com/user/my-skill.git` → `skills/community/my-skill/`)
   - 克隆后验证: 检查 `skill.yaml` 是否存在 + Schema 验证
   - 失败回滚: 克隆失败或验证失败则删除目录
2. **安全扫描** (~50 行，集成到 git-installer.ts 或单独文件):
   - 检查 skill.yaml 中是否有 `risk_level_max: critical` 或 `forbidden` — 警告用户
   - 扫描 prompt 长度 (异常大的 prompt 可能是注入尝试)
   - 不执行任何从 Git 仓库引入的可执行文件
3. **更新 api/routes/skills.ts**:
   - `POST /api/v1/skills/install` 扩展 body: `{ name, source, gitUrl? }`
   - 当 `gitUrl` 存在时: 调用 `installFromGitUrl()` → 再调用 `engine.install()`
   - 权限: `skill:manage` (仅 admin/owner 可安装社区 Skill)
4. **git-installer.test.ts** (~100 行):
   - Mock `child_process.exec` (不实际 git clone)
   - 测试: 有效 URL 解析、无效 URL 拒绝、协议限制 (ssh 拒绝)
   - 测试: 克隆后验证成功/失败
   - 测试: 失败回滚清理目录

**验收标准**:
- 能通过 API 传入 Git HTTPS URL 安装社区 Skill
- 仅允许 HTTPS 协议 (拒绝 SSH/Git 协议)
- 克隆后自动验证 skill.yaml 合规性
- 失败时自动清理目录 (无残留)
- 测试 ≥ 8 个

**影响范围**:
- `packages/server/src/core/skill/git-installer.ts` (新建)
- `packages/server/src/core/skill/git-installer.test.ts` (新建)
- `packages/server/src/api/routes/skills.ts` (修改 — 扩展 install 端点)
- `packages/server/src/api/routes/schemas.ts` (修改 — 扩展 InstallSkillBody)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 00:42:09

---

### [completed] Skill 链式触发 — skill.completed 事件驱动下游 Skill ✅

**ID**: skill-012
**优先级**: P4
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — `engine.ts` 执行完成后不发布任何事件；`trigger-manager.ts` 不存在 (依赖 skill-006)；Skill 的 trigger 类型定义中 `event` 支持 `skill.completed` 但无实现
**实现方案**:

1. **更新 engine.ts** — 执行成功后发布 `skill.completed` 事件:
   - 在 `execute()` 方法成功路径末尾: `getSkillEventBus().emit('skill.completed', { skillId, skillName, serverId, executionId, result })`
   - 失败时发布 `skill.failed` 事件
2. **更新 trigger-manager.ts** — 订阅 `skill.completed` 事件:
   - 在 `registerEvent()` 中: 当 eventTypes 包含 `skill.completed` 时注册监听
   - 事件匹配: 检查 trigger 配置中的 filter 条件 (如 `source_skill: log-auditor`)
   - 触发: 调用 `SkillEngine.execute()` with `triggerType='event'`
   - 防循环: 检测 A → B → A 的循环链并拒绝 (深度限制 ≤ 5 级)
3. **更新 shared/skill-schema.ts** — event trigger 添加 `source_skill` 过滤字段:
   - `EventTriggerSchema` 扩展: `filter?: { source_skill?: string }` — 仅当指定 Skill 完成时触发
4. **测试** (~100 行):
   - Skill A 完成 → 触发 Skill B 执行
   - 过滤: source_skill 不匹配时不触发
   - 循环检测: A → B → A 被拦截
   - 深度限制: 链长度 > 5 被拒绝

**验收标准**:
- Skill A 执行成功后自动触发配置了 `event: skill.completed` 的 Skill B
- 支持 `source_skill` 过滤 (只响应特定 Skill 的完成事件)
- 循环链检测防止无限触发
- 链深度 ≤ 5 级
- 测试 ≥ 6 个

**影响范围**:
- `packages/server/src/core/skill/engine.ts` (修改 — 发布事件)
- `packages/server/src/core/skill/trigger-manager.ts` (修改 — 订阅 skill.completed)
- `packages/shared/src/skill-schema.ts` (修改 — 扩展 EventTriggerSchema)
- `packages/server/src/core/skill/trigger-manager.test.ts` (修改 — 链式触发测试)

**创建时间**: (自动填充)
**完成时间**: 2026-02-13 01:43:29


**ID**: skill-001
**优先级**: P0
**模块路径**: packages/server/src/db/
**当前状态**: 文件不存在 — `schema.ts` 中无任何 skill 相关表定义；`migrations/` 中无 skill migration (当前最新 0009)；`repositories/skill-repository.ts` 不存在
**实现方案**:

1. **schema.ts** — 新增 3 张表：
   - `installedSkills`: id, userId, tenantId, name, displayName, version, source('official'|'community'|'local'), skillPath, status('installed'|'configured'|'enabled'|'paused'|'error'), config(JSON), createdAt, updatedAt
   - `skillExecutions`: id, skillId, serverId, userId, triggerType('manual'|'cron'|'event'|'threshold'), status('running'|'success'|'failed'|'timeout'), startedAt, completedAt, result(JSON), stepsExecuted, duration
   - `skillStore`: id, skillId, key, value, updatedAt (unique on skillId+key)
2. **migrations/0010_skills.sql** — DDL 创建 3 张表 + 索引
3. **repositories/skill-repository.ts** — 实现 `SkillRepository` 接口:
   - 接口: `findAll(userId)`, `findById(id)`, `install(input)`, `updateStatus(id, status)`, `updateConfig(id, config)`, `uninstall(id)`, `findByName(userId, name)`
   - `DrizzleSkillRepository` — SQLite 实现
   - `InMemorySkillRepository` — 测试实现
   - 单例: `getSkillRepository()` / `setSkillRepository()` / `_resetSkillRepository()`
4. **repositories/skill-execution-repository.ts** — 执行记录 CRUD:
   - `create()`, `findBySkillId(skillId, limit)`, `findById(id)`, `updateStatus(id, status, result)`
   - Drizzle + InMemory 双实现，单例模式
5. **更新 `createTables()`** — 确保 skill 表在 seed 时自动建表

**验收标准**:
- `pnpm --filter @aiinstaller/server build` 无类型错误
- Repository 单元测试 ≥ 20 个 (两种实现各覆盖所有 CRUD 方法)
- InMemory 实现可用于后续引擎测试

**影响范围**:
- `packages/server/src/db/schema.ts` (修改 — 新增表)
- `packages/server/src/db/migrations/0010_skills.sql` (新建)
- `packages/server/src/db/repositories/skill-repository.ts` (新建)
- `packages/server/src/db/repositories/skill-execution-repository.ts` (新建)
- `packages/server/src/db/schema.ts` → `createTables()` (更新)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 22:04:30

---

### [completed] SkillLoader — YAML 解析 + Schema 验证 + 变量模板引擎 ✅

**ID**: skill-002
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `core/skill/` 目录不存在 — 整个引擎为空白状态
**实现方案**:

1. **创建 `core/skill/` 目录**
2. **loader.ts** (~200 行):
   - `loadSkillFromDir(dirPath: string): Promise<SkillManifest>` — 读取 `skill.yaml`，YAML 解析，调用 shared 的 `validateSkillManifest()` 验证
   - `scanSkillDirectories(basePaths: string[]): Promise<ScannedSkill[]>` — 扫描 `skills/official/` 和自定义目录，返回所有可用 Skill
   - `resolvePromptTemplate(prompt: string, vars: TemplateVars): string` — 替换 `{{input.*}}`, `{{server.*}}`, `{{env.*}}` 变量
   - `checkRequirements(requires: SkillManifest['requires'], serverProfile?: ServerProfile): RequirementCheckResult` — OS/命令/Agent 版本检查
   - 使用 `js-yaml` 库解析 YAML（需添加依赖: `pnpm --filter @aiinstaller/server add js-yaml && pnpm --filter @aiinstaller/server add -D @types/js-yaml`）
3. **loader.test.ts** (~200 行):
   - 测试: 有效 YAML 解析 (使用 official 的 3 个 Skill)、无效 YAML 拒绝、缺少 kind/version 拒绝
   - 测试: 模板变量替换 (正常替换、未定义变量保留、嵌套变量)
   - 测试: 需求检查 (OS 匹配/不匹配、命令依赖)
   - 测试: 目录扫描 (空目录、多个 Skill、无效 Skill 跳过)

**验收标准**:
- 能成功加载 `skills/official/` 下的 3 个官方 Skill
- 模板变量 `{{input.backup_dir}}` 被正确替换为用户配置值
- 无效 YAML / 不合规 Schema 抛出明确错误消息
- 测试 ≥ 15 个

**影响范围**:
- `packages/server/src/core/skill/loader.ts` (新建)
- `packages/server/src/core/skill/loader.test.ts` (新建)
- `packages/server/package.json` (新增 js-yaml 依赖)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 22:27:15

---

### [completed] SkillEngine 核心引擎 — 单例编排 + 手动执行流程 ✅

**ID**: skill-003
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — 依赖 skill-001 (Repository) 和 skill-002 (Loader) 完成
**实现方案**:

1. **types.ts** (~80 行) — 引擎内部类型:
   - `SkillExecutionResult`: status, stepsExecuted, duration, result (JSON), errors
   - `AvailableSkill`: manifest + source + installed (boolean)
   - `SkillRunParams`: skillId, serverId, userId, triggerType, config
   - `InstalledSkillWithManifest`: InstalledSkill + parsed SkillManifest
2. **engine.ts** (~300 行):
   - `SkillEngine` 类: 单例模式 (`getSkillEngine()` / `setSkillEngine()` / `_resetSkillEngine()`)
   - 构造参数: `InstallServer` 引用 (用于获取 TaskExecutor 等服务)
   - `install(userId, skillDir, source): Promise<InstalledSkill>` — 加载 → 验证 → 持久化到 DB
   - `uninstall(skillId): Promise<void>` — 停止触发器 → 删除 DB 记录
   - `configure(skillId, config): Promise<void>` — 更新用户配置 (inputs 值)
   - `updateStatus(skillId, status): Promise<void>` — enabled/paused/error 切换
   - `execute(skillId, serverId, userId, triggerType): Promise<SkillExecutionResult>` — 核心执行:
     - 从 DB 加载 InstalledSkill → 用 Loader 解析 YAML → 检查需求
     - 解析模板变量 (注入 config + server info)
     - 创建执行记录 (status=running)
     - **Phase 1 (本任务)**: 记录 prompt 到结果 (AI Runner 在 skill-005 接入)
     - 更新执行记录 (status=success/failed)
   - `listInstalled(userId): Promise<InstalledSkill[]>` — 列表查询
   - `listAvailable(): Promise<AvailableSkill[]>` — 扫描所有可安装 Skill
   - `getExecutions(skillId, limit): Promise<SkillExecution[]>` — 执行历史
   - `start()` / `stop()` — 生命周期 (TriggerManager 留给后续任务)
3. **engine.test.ts** (~250 行):
   - 使用 InMemory repositories + 临时 Skill 目录 (含有效 skill.yaml)
   - 测试: 安装流程 (成功、重复安装拒绝、无效 Skill 拒绝)
   - 测试: 卸载 (成功、不存在报错)
   - 测试: 配置更新、状态切换
   - 测试: 执行 (手动触发成功、Skill 未启用拒绝)
   - 测试: 列表查询、执行历史

**验收标准**:
- 完整的安装→配置→执行→卸载生命周期
- 单例模式正确 (get/set/_reset)
- 手动执行能走通完整流程 (不含 AI，留给 skill-005)
- 测试 ≥ 20 个

**影响范围**:
- `packages/server/src/core/skill/engine.ts` (新建)
- `packages/server/src/core/skill/engine.test.ts` (新建)
- `packages/server/src/core/skill/types.ts` (新建)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 23:16:16

---

### [completed] RBAC 权限 + REST API 路由 + 服务注册 ✅

**ID**: skill-004
**优先级**: P0
**模块路径**: packages/shared/src/rbac.ts + packages/server/src/api/routes/
**当前状态**: `rbac.ts` 中无任何 skill 权限 (当前 32 权限，0 个 skill:*)；`api/routes/skills.ts` 不存在；`index.ts` 和 `routes/index.ts` 中无 skill 引用
**实现方案**:

1. **shared/src/rbac.ts** — 新增 3 个权限:
   - `'skill:view'` → MEMBER_PERMISSIONS (查看列表和历史)
   - `'skill:execute'` → ADMIN_PERMISSIONS (手动执行, admin+owner)
   - `'skill:manage'` → ADMIN_PERMISSIONS (安装/卸载/配置, admin+owner)
   - 更新 PERMISSIONS 数组 (保持按模块分组)
2. **rebuild shared**: `pnpm --filter @aiinstaller/shared build`
3. **api/routes/skills.ts** (~300 行):
   - `GET /` — 列出已安装 Skills (requirePermission('skill:view'))
   - `POST /install` — 安装 Skill (requirePermission('skill:manage'))
   - `DELETE /:id` — 卸载 (requirePermission('skill:manage'))
   - `PUT /:id/config` — 配置 inputs (requirePermission('skill:manage'))
   - `PUT /:id/status` — 启用/暂停 (requirePermission('skill:manage'))
   - `POST /:id/execute` — 手动执行 (requirePermission('skill:execute'))，接收 `{ serverId }` body
   - `GET /:id/executions` — 执行历史 (requirePermission('skill:view'))
   - `GET /:id/executions/:eid` — 执行详情 (requirePermission('skill:view'))
   - `GET /available` — 可安装列表 (requirePermission('skill:view'))
   - 所有写入端点使用 Zod 验证请求体
   - 全链路中间件: requireAuth → resolveRole → requirePermission
4. **api/routes/index.ts** — 挂载 `v1.route('/skills', skills)`
5. **index.ts** — 在 `createServer()` 中初始化 `getSkillEngine(server)`；在 `startServer()` 中调用 `getSkillEngine().start()`
6. **api/routes/skills.test.ts** (~300 行):
   - 使用 InMemory repositories + mock auth
   - 测试所有 9 个端点: 正常响应 + 输入验证
   - 测试 RBAC: member 只能 view，不能 manage/execute
   - 测试错误: 404 skillId, 400 缺参数

**验收标准**:
- 所有 9 个 API 端点返回正确状态码和格式
- RBAC 权限正确隔离 (member/admin/owner)
- `pnpm --filter @aiinstaller/shared build` + `pnpm typecheck` 全部通过
- 测试 ≥ 25 个 (路由 + RBAC)

**影响范围**:
- `packages/shared/src/rbac.ts` (修改 — 新增 3 权限)
- `packages/server/src/api/routes/skills.ts` (新建)
- `packages/server/src/api/routes/skills.test.ts` (新建)
- `packages/server/src/api/routes/index.ts` (修改 — 挂载路由)
- `packages/server/src/api/routes/schemas.ts` (修改 — 新增请求体 Zod schemas)
- `packages/server/src/index.ts` (修改 — SkillEngine 初始化 + 启动)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 23:20:20

---

### [completed] SkillRunner — AI 自主执行层 + 安全约束 + 审计集成 ✅

**ID**: skill-005
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: 不存在 — 依赖 skill-003 (SkillEngine) 完成后接入。参考 `ai/agentic-chat.ts` 中的 tool_use 自主循环模式
**实现方案**:

1. **runner.ts** (~350 行):
   - `SkillRunner` 类 — 单次 Skill 执行的 AI 循环:
     - `run(params: SkillRunParams): Promise<SkillRunResult>` — 核心方法
     - 构建 AI messages: system prompt (Skill 专用) + skill prompt (从 YAML 解析后注入变量) + trigger context
     - Tool 定义 (根据 skill.yaml 的 `tools` 字段动态生成):
       - `shell`: 执行命令 → `getTaskExecutor().execute()` 发送到 Agent
       - `read_file`: 读取服务器文件
       - `write_file`: 写入服务器文件
       - `notify`: 发送通知 → `getWebhookDispatcher().dispatch()` 事件
       - `http`: HTTP 请求 (受限域名)
       - `store`: KV 存储读写
     - Agentic loop (参考 `agentic-chat.ts`):
       - AI 返回 tool_use → 安全检查 → 执行工具 → 返回结果 → 再次调用 AI
       - 终止: AI 返回 end_turn / 达到 max_steps / 超时
     - **安全集成**:
       - `shell` 工具: `classifyCommand()` 风险分级 → 对比 `constraints.risk_level_max` → 超限拒绝
       - `risk_level === 'forbidden'` → 永远拒绝
       - 所有 shell 命令通过 `getAuditLogger().log()` 记录
     - **超时 & 步数**:
       - `parseTimeout(timeout: string): number` — "30s"→30000, "5m"→300000, "1h"→3600000
       - `constraints.max_steps` 计数器 (每个 tool_use +1)
       - `setTimeout` 全局超时保护
2. **runner.test.ts** (~250 行):
   - Mock AIProvider 返回预设 tool_use 响应
   - 测试: 单步 shell 执行 → 成功结果
   - 测试: 多步循环 (read_file → shell → notify)
   - 测试: 安全拒绝 (red 命令 + yellow max → 拒绝)
   - 测试: 超时终止 (1s timeout → timeout 状态)
   - 测试: 步数限制 (max_steps=2 → 第 3 步停止)
   - 测试: 审计日志记录验证
3. **更新 engine.ts** — `execute()` 方法接入 SkillRunner:
   - 替换 Phase 1 的占位逻辑为真实 AI 执行
   - 传递 constraints, tools, resolved prompt 到 runner

**验收标准**:
- AI 自主循环能执行 3+ 步的多步 Skill (mock AI)
- `classifyCommand()` 安全检查正确拦截超限命令
- 超时和步数限制正确终止循环
- 所有 shell 执行记录到 audit_log
- 测试 ≥ 18 个

**影响范围**:
- `packages/server/src/core/skill/runner.ts` (新建)
- `packages/server/src/core/skill/runner.test.ts` (新建)
- `packages/server/src/core/skill/engine.ts` (修改 — 接入 runner)

**创建时间**: 2026-02-12
**完成时间**: 2026-02-12 23:40:45

---

## 🔮 后续任务预告 (当前批次完成后生成)

| ID | 优先级 | 标题 | 依赖 |
|----|--------|------|------|
| skill-006 | P2 | TriggerManager — Cron/Event/Threshold 触发调度 | skill-005 |
| skill-007 | P2 | Skill KV Store — 每个 Skill 的持久化存储 API | skill-001 |
| skill-008 | P3 | Dashboard — 前端类型 + Zustand Store + API 集成 | skill-004 |
| skill-009 | P3 | Dashboard — Skills 管理页面 + UI 组件 | skill-008 |
| skill-010 | P3 | SSE 推送 — Skill 执行实时进度流 | skill-005 |
| skill-011 | P4 | 社区 Skill 安装 — 从 Git URL 安装 | skill-003 |
| skill-012 | P4 | Skill 链式触发 — skill.completed 事件驱动 | skill-006 |

---

## 使用说明

任务状态: `[pending]` → `[in_progress]` → `[completed]` / `[failed]`
