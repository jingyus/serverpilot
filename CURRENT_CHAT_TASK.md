### [pending] Legacy 模式 SSE 错误处理器中 writeSSE 可能二次抛出 — 流已关闭时写入无 try/catch

**ID**: chat-051
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: chat.ts 第 301-314 行的 legacy 模式 catch 块中，`await stream.writeSSE({ event: 'message', ... })` 和 `await stream.writeSSE({ event: 'complete', ... })` 没有 try/catch 保护。如果客户端已断连（流已关闭），这两个 await 会抛出异常，导致错误从 catch 块逃逸到全局错误处理器，SSE 流非正常关闭。同样的问题也存在于 agentic 模式的 catch 块（第 174-181 行）。对比 agentic-chat.ts 内部的 `writeSSE` 方法（第 684-696 行）有 try/catch 保护，但 chat.ts 路由层没有使用该封装。
**改进方案**: 将 catch 块中的 SSE 写入包裹在 try/catch 中，或提取为 `safeWriteSSE()` 辅助函数。失败时仅记录日志，不再重新抛出。同时为 agentic 模式的 catch 块（第 174-181 行）应用相同修复。
**验收标准**: (1) 客户端断连后 catch 块中的 SSE 写入不会抛出未捕获异常; (2) 错误日志正确记录; (3) 两个模式（agentic/legacy）的 catch 块都有保护
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
