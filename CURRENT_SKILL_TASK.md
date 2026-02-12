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
