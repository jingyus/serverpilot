### [pending] cancelStream 未重置执行相关状态 — 取消流式后 UI 可能显示旧的执行进度

**ID**: chat-090
**优先级**: P1
**模块路径**: packages/dashboard/src/stores/
**发现的问题**: `cancelStream()` (chat.ts:189-208) 只重置 `isStreaming` 和 `streamingContent`，不重置 `execution`、`executionMode`、`pendingConfirm`、`agenticConfirm`、`currentPlan`、`planStatus`、`toolCalls` 等状态。如果用户在 agentic 模式执行命令时按 Escape 取消：(1) `agenticConfirm` 可能残留，显示一个无法操作的确认栏 (2) `toolCalls` 列表不清除，显示过时的工具调用记录 (3) `executionMode` 仍为 `'inline'` 或 `'log'`，下次对话可能误显示执行日志。`cleanup()` (行 210-221) 也遗漏了 `toolCalls`、`currentPlan`、`planStatus`、`execution`。
**改进方案**: `cancelStream` 中增加执行状态重置。对比 `newSession()` (行 168-187) 的完整重置列表，确保 `cancelStream` 也重置 `executionMode`、`pendingConfirm`、`agenticConfirm`、`toolCalls`。`cleanup` 同步更新。
**验收标准**: (1) Escape 取消后所有执行相关 UI 清除 (2) 不影响已持久化的消息 (3) 现有测试通过 (4) 新增测试验证取消后状态清洁
**影响范围**: `packages/dashboard/src/stores/chat.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
