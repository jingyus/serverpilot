### [pending] Plan 完成后未从 Session.plans Map 中清除 — 阻止缓存驱逐

**ID**: chat-025
**优先级**: P1
**模块路径**: packages/server/src/core/session/manager.ts, packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `manager.ts:174-176` 的 `isActive()` 判断 `session.plans.size > 0` 来保护活跃会话不被驱逐。但 plan 执行完成后，`chat-execution.ts:424` 只从 `activePlanExecutions` Map 中删除了 planId，**从未**调用 `sessionMgr.removePlan(sessionId, planId)` 或类似方法清除 `session.plans` Map 中的条目。这意味着任何执行过至少一个 plan 的会话的 `plans.size` 永远 > 0，`isActive()` 永远返回 true，该会话**永远不会被 LRU 驱逐或 TTL 过期**。长期运行的服务器会因此累积所有曾执行过 plan 的会话，内存持续增长。
**改进方案**: 
1. 在 `SessionManager` 中添加 `removePlan(sessionId: string, planId: string)` 方法
2. 在 `executePlanSteps` 完成后（`chat-execution.ts:424` 附近）调用 `sessionMgr.removePlan(sessionId, planId)` 
3. 在 `rejectAllPendingDecisions` 和取消流程中也清理对应 plan
4. 或改进 `isActive()` 逻辑，让它区分"有活跃执行的 plan"和"已完成的 plan"
**验收标准**: 
- Plan 执行完成后 `session.plans.size` 回到 0
- 执行完 plan 的不活跃会话可以被 LRU 驱逐和 TTL 过期
- 新增测试：plan 执行后验证 plans Map 被清理
**影响范围**: packages/server/src/core/session/manager.ts, packages/server/src/api/routes/chat-execution.ts
**创建时间**: (自动填充)
**完成时间**: -

---
