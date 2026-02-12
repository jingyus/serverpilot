### [pending] loadSession 未重置执行/Agentic 状态 — 切换会话后显示旧执行数据

**ID**: chat-021
**优先级**: P0
**模块路径**: packages/dashboard/src/stores/chat-sessions.ts
**发现的问题**: `chat-sessions.ts:41-47` 的 `createLoadSession` 函数在加载新会话时只重置了 `currentPlan` 和 `planStatus`，但没有重置 `execution`、`executionMode`、`pendingConfirm`、`agenticConfirm`、`toolCalls`、`isStreaming`、`isAgenticMode`、`streamingContent`、`sseParseErrors` 状态。对比 `chat.ts:125-143` 的 `newSession` 函数会完整重置所有状态。当用户从一个正在执行的会话 A 切换到会话 B 时，ExecutionLog 仍显示 A 的执行步骤，AgenticConfirmBar 可能还显示旧的确认请求，toolCalls 数组保留了旧数据。
**改进方案**: 
1. 在 `createLoadSession` 成功加载会话后，增加完整的状态重置
2. 重置字段应与 `newSession` 保持一致：`execution: INITIAL_EXECUTION`、`executionMode: 'none'`、`pendingConfirm: null`、`agenticConfirm: null`、`toolCalls: []`、`isAgenticMode: false`、`isStreaming: false`、`streamingContent: ''`、`sseParseErrors: 0`
3. 同时调用 `getActiveHandle()?.abort()` 中止当前 SSE 连接（避免旧连接继续写入新会话状态）
**验收标准**: 
- 从有执行进度的会话切换到另一个会话后，ExecutionLog 不显示
- AgenticConfirmBar 和 StepConfirmBar 不显示旧确认
- toolCalls 数组清空
- 活跃 SSE 连接被正确中止
- 新增测试：验证 loadSession 后所有执行状态已重置
**影响范围**: packages/dashboard/src/stores/chat-sessions.ts, packages/dashboard/src/stores/chat-sessions.test.ts
**创建时间**: (自动填充)
**完成时间**: -

---
