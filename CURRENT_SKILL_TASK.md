### [pending] SSE 推送 — Skill 执行实时进度流

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
**完成时间**: -

---
