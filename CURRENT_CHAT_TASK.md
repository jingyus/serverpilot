### [pending] SSE 连接无并发上限 — 快速切换服务器/会话可能耗尽浏览器连接数

**ID**: chat-062
**优先级**: P2
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: sse.ts 第 102-220 行的 `createSSEConnection()` 每次调用创建新的 SSE 连接（AbortController + fetch），没有并发连接数限制。虽然 chat store 的 `sendMessage`（第 90 行）会在创建新连接前 abort 旧连接，但 abort 是异步的 — 旧连接可能尚未关闭时新连接已建立。加上 `createGetSSE`（第 244 行）用于 metrics/status 流，浏览器对同一域名的并发连接限制通常为 6 个（HTTP/1.1），可能被耗尽。
**改进方案**: 在 sse.ts 模块级维护一个活跃连接 Set，`createSSEConnection` 创建前检查上限（如最大 3 个 POST SSE），超出时先同步关闭最旧的连接。或在 chat store 层面确保 abort 完成后才创建新连接。
**验收标准**: (1) 任意时刻最多 N 个活跃 SSE 连接; (2) 旧连接在新连接创建前被完全关闭; (3) 不影响 metrics SSE 流; (4) 测试覆盖连接数限制场景
**影响范围**: packages/dashboard/src/api/sse.ts, packages/dashboard/src/stores/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
