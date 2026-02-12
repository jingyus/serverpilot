### [pending] SSE 重连复用原始请求体 — 可能导致服务端重复处理用户消息

**ID**: chat-019
**优先级**: P2
**模块路径**: packages/dashboard/src/api/sse.ts
**发现的问题**: `sse.ts:172` 重连时复用创建连接时的 `body` 闭包（包含原始 `message` 字段）。Chat SSE 是 POST 请求，重连会再次发送 `{ message: "用户的问题", sessionId: "xxx" }`。如果服务端的 `/chat/:serverId` 路由不是幂等的（每次都创建新 assistant 消息和 AI 调用），重连会导致用户消息被重复处理、AI 重复回答。
**改进方案**: 
1. 重连时移除 `message` 字段，只发送 `{ sessionId, reconnect: true }`
2. 服务端识别 `reconnect: true` 后恢复现有 SSE 流（而非开始新对话）
3. 或改为 GET 请求 + EventSource 标准协议（可利用浏览器原生重连的 `Last-Event-Id`）
4. 至少：在重连时添加 `X-Reconnect: true` 头部让服务端判断
**验收标准**: 
- 网络断开重连后不产生重复的 AI 回复
- 重连后 SSE 流从断点恢复（或至少不重复已发送的内容）
- 新增测试覆盖重连幂等性
**影响范围**: packages/dashboard/src/api/sse.ts, packages/server/src/api/routes/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
