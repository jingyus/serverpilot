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
