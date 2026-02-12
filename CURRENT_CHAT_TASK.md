### [pending] waitForStepDecision 超时无 SSE 反馈 — 用户等 5 分钟后无任何提示

**ID**: chat-039
**优先级**: P1
**模块路径**: packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `waitForStepDecision()`（第 121-133 行）创建 Promise，5 分钟后 `setTimeout` 自动 resolve('reject')。但超时发生时：1) 没有 SSE 事件通知前端 2) 前端仍显示 step confirm UI，用户以为还在等待 3) `pendingDecisions.delete(key)` 后，如果用户此时点击 approve，`resolveStepDecision()` 返回 false（未找到），前端收到 404 但不知道原因。
**改进方案**: 1) 超时时发送 SSE 事件 `step_decision_timeout`（含 stepId 和原因） 2) 前端收到此事件后自动关闭 confirm UI 并显示 "Step confirmation timed out" 提示 3) 前端 step confirm UI 显示倒计时。
**验收标准**: 1) 超时发送 SSE 事件 2) 前端自动关闭过期的 confirm UI 3) 新增 2+ 测试覆盖超时场景 4) 用户体验无"静默失败"
**影响范围**: `packages/server/src/api/routes/chat-execution.ts`, `packages/dashboard/src/stores/chat-execution.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
