### [pending] pendingConfirmations 在 SSE 断连时未清理 — 定时器和 Promise 泄漏

**ID**: chat-050
**优先级**: P0
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: chat.ts 第 51-54 行声明的 `pendingConfirmations` Map，在第 142-152 行创建 confirmation 时设置了 5 分钟超时定时器，但当 SSE 流断连（客户端关闭页面）时，没有任何清理机制。定时器继续运行直到 5 分钟后才自然过期。同时 agentic-chat.ts 第 502 行 `await confirmation.approved` 会无限挂起，直到超时 resolve(false)。问题链路：(1) 用户关闭页面 → (2) stream.onAbort 在 agentic-chat.ts:196 设置 abort.aborted=true → (3) 但 chat.ts 中的 pendingConfirmations 定时器仍在运行 → (4) Promise 挂起最多 5 分钟 → (5) 内存泄漏。
**改进方案**: 在 chat.ts 的 agentic 模式 SSE handler 中注册 `stream.onAbort()` 回调，遍历当前 session 关联的 pendingConfirmations，调用 `clearTimeout(timer)` 并 `resolve(false)`，然后从 Map 中删除。可以通过 confirmId 的前缀 `${session.id}:` 来过滤当前 session 的 confirmations。
**验收标准**: (1) SSE 断连后 5 秒内相关 pendingConfirmations 条目被清除; (2) 无 5 分钟定时器残留; (3) agentic 循环不再挂起等待已断连客户端的确认; (4) 测试覆盖断连清理场景
**影响范围**: packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
