# Skill 插件系统开发任务队列

> 此队列专注于 Skill 插件系统的设计与实现
> AI 自动扫描 → 发现缺失 → 设计实现 → 验证

**最后更新**: 2026-02-12 22:27:48

## 📊 统计

- **总任务数**: 5
- **待完成** (pending): 0
- **进行中** (in_progress): 3
- **已完成** (completed): 2
- **失败** (failed): 0

## 📋 任务列表

### [completed] DB Schema + Migration + SkillRepository 数据层 ✅

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

### [in_progress] SkillEngine 核心引擎 — 单例编排 + 手动执行流程

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
**完成时间**: -

---

### [in_progress] RBAC 权限 + REST API 路由 + 服务注册

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
**完成时间**: -

---

### [in_progress] SkillRunner — AI 自主执行层 + 安全约束 + 审计集成

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
**完成时间**: -

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
