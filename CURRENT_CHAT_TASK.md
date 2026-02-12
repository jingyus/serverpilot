### [pending] 全局 setProgressCallback 竞态条件 — 并发用户执行命令时输出串台

**ID**: chat-007
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts, packages/server/src/ai/agentic-chat.ts
**发现的问题**: `chat.ts:149` 和 `agentic-chat.ts:491` 都通过 `executor.setProgressCallback()` 设置全局回调。TaskExecutor 是单例，若两个用户同时执行命令，第二个用户的回调会覆盖第一个用户的，导致第一个用户的 SSE 停止接收实时输出，或输出被路由到错误用户的流。此外 `agentic-chat.ts:491` 的回调设置后从不调用 `executor.setProgressCallback(null)` 清理（而 `chat.ts:317` 会清理），造成闭包引用 SSE stream 无法被 GC。
**改进方案**: 
1. 将 `setProgressCallback` 改为基于执行 ID 的回调注册：`executor.onProgress(executionId, callback)` / `executor.offProgress(executionId)`
2. 或者为每次执行创建独立的 progress channel（EventEmitter 模式），避免全局覆盖
3. `agentic-chat.ts` 中 `toolExecuteCommand` 完成后必须清理回调
4. 添加并发执行的集成测试验证输出不串台
**验收标准**: 
- 两个用户同时执行命令时各自 SSE 收到正确的实时输出
- Agentic 模式执行完成后 progress callback 被清理
- 无 SSE stream 闭包泄漏
**影响范围**: packages/server/src/api/routes/chat.ts, packages/server/src/ai/agentic-chat.ts, packages/server/src/core/task/executor.ts
**创建时间**: (自动填充)
**完成时间**: -

---
