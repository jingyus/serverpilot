# Skill 插件系统开发任务队列

> 此队列专注于 Skill 插件系统的设计与实现
> AI 自动扫描 → 发现缺失 → 设计实现 → 验证

**最后更新**: 2026-02-13 01:27:45

## 📊 统计

- **总任务数**: 12
- **待完成** (pending): 1
- **进行中** (in_progress): 0
- **已完成** (completed): 11
- **失败** (failed): 0

## 📋 任务列表

### [completed] DB Schema + Migration + SkillRepository 数据层 ✅
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

### [pending] Skill 链式触发 — skill.completed 事件驱动下游 Skill

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
**完成时间**: -


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
