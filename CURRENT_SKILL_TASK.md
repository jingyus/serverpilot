### [pending] Skill 执行日志持久化 — 步骤级别日志写入 DB

**ID**: skill-079
**优先级**: P1
**模块路径**: packages/server/src/
**当前状态**: SSE 事件（step/log/error）仅通过内存 EventEmitter 传输，不持久化。断连后无法回看历史执行的详细步骤日志。虽然 `result.toolResults[]` 保存了工具调用记录，但 AI 的中间推理文本和 log 类事件丢失。
**实现方案**: 
1. 在 `db/schema.ts` 添加 `skill_execution_logs` 表:
   - `id`, `executionId`, `eventType` (step|log|error), `data` (JSON), `createdAt`
2. 创建 migration `0012_skill_execution_logs.sql`
3. 在 `skill-repository.ts` 添加 `appendLog(executionId, eventType, data)` 和 `getLogs(executionId)` 方法
4. 在 `skill-event-bus.ts` 的 `publish()` 中，对每个事件同时写入 DB (异步，不阻塞 SSE)
5. 在 API `GET /skills/:id/executions/:eid` 响应中包含 logs 数组
6. 对应测试
**验收标准**: 
- 所有 SSE 事件同时写入 `skill_execution_logs` 表
- 执行详情 API 返回完整日志列表
- DB 写入异步执行，不影响 SSE 延迟
- 测试覆盖: ≥10 个测试用例
**影响范围**: packages/server/src/db/schema.ts, packages/server/src/core/skill/skill-event-bus.ts, packages/server/src/db/repositories/skill-repository.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
