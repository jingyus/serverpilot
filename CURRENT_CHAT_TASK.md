### [pending] Agentic 确认流在客户端断连后仍继续等待 — confirmation.approved 未与 abort 联动

**ID**: chat-056
**优先级**: P1
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 第 491-514 行的确认流程中，第 502 行 `const approved = await confirmation.approved` 会无条件等待用户确认。如果客户端已断连（abort.aborted=true），这个 await 仍然会挂起最多 5 分钟（由 chat.ts 的 CONFIRM_TIMEOUT_MS 控制）。虽然第 517-520 行有 abort 检查，但只在确认 resolve 后才到达。这意味着一个已断连的客户端会让服务端的 agentic 循环挂起 5 分钟，占用内存和协程资源。
**改进方案**: 使用 `Promise.race()` 将 `confirmation.approved` 与一个 abort 感知的 Promise 竞争。当 abort.aborted 为 true 时立即 resolve(false)。可以实现为：`const approved = await Promise.race([confirmation.approved, this.waitForAbort(abort)])` 其中 waitForAbort 定期检查 abort 状态或监听 abort 事件。
**验收标准**: (1) 客户端断连后确认等待在 1 秒内结束; (2) 不再有 5 分钟挂起; (3) abort 后工具执行不会继续; (4) 测试覆盖断连+确认竞态场景
**影响范围**: packages/server/src/ai/agentic-chat.ts, packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
