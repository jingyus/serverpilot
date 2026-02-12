### [pending] activePlanExecutions 初始值为空字符串 — 取消执行可能失败

**ID**: chat-024
**优先级**: P1
**模块路径**: packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `chat-execution.ts:259` 将 `activePlanExecutions.set(planId, '')` 设为空字符串，表示执行已开始但 executionId 尚未就绪。然后在 `chat-execution.ts:268`（progress listener 回调中）才更新为真实 executionId。如果用户在这两行之间发起取消请求，`chat.ts:412` 的 `getActiveExecution(body.planId)` 返回空字符串 `''`，传入 `executor.cancelExecution('')` 导致取消失败（因为没有 executionId 为空的执行）。虽然 `removeActiveExecution` 仍会清除 Map 条目使 step 循环在 `chat-execution.ts:277` break，但 `chat.ts:422` 的 `cancelled` 变量为 false，返回 `{ success: false }` 给前端——用户看到"取消失败"但实际已停止。
**改进方案**: 
1. 在 `executePlanSteps` 入口处生成 executionId（`randomUUID()`），直接 `activePlanExecutions.set(planId, executionId)` 
2. 将 executionId 传入 progress listener，listener 只用于路由 output
3. 或在 `getActiveExecution` 返回空字符串时返回 undefined（视为无活跃执行）
4. 在取消端点中，如果 `executionId` 为空则至少返回 `success: true`（因为 step 循环会 break）
**验收标准**: 
- 用户在执行刚开始时点击取消，前端收到 `{ success: true }`
- `activePlanExecutions` 不再出现空字符串值
- 新增测试：执行开始后立即取消的场景
**影响范围**: packages/server/src/api/routes/chat-execution.ts, packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
