### [pending] 删除会话未检查活跃执行 — 用户删除正在执行的会话导致悬挂资源

**ID**: chat-088
**优先级**: P1
**模块路径**: packages/server/src/api/routes/
**发现的问题**: DELETE `/chat/:serverId/sessions/:sessionId` (chat.ts:655-676) 直接调用 `sessionMgr.deleteSession()` 删除会话，不检查该会话是否有正在运行的 agentic 循环或 plan 执行。`deleteSession` (manager.ts:329-337) 会从缓存中删除会话（包括 plans Map），但服务端的 agentic 循环、`pendingConfirmations`、`activePlanExecutions` 等状态不会被清理。会话删除后：(1) 正在运行的 `agenticEngine.run()` 继续执行但无法写入消息 (2) pendingConfirmations 中该 session 的确认不会被 cleanup (3) 用户无法取消已删除会话的执行。
**改进方案**: 在 DELETE 路由中先检查 `session.plans.size > 0` 或 `hasActiveExecution()`，如果有活跃执行返回 409 Conflict 并提示用户先取消执行。或者自动触发 `cleanupSessionConfirmations(sessionId)` 和取消所有活跃执行。
**验收标准**: (1) 删除有活跃执行的会话时返回 409 或自动取消 (2) 确认和执行状态被正确清理 (3) 新增测试覆盖此场景
**影响范围**: `packages/server/src/api/routes/chat.ts`, `packages/server/src/api/routes/chat.test.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
