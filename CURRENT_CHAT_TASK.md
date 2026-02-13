### [pending] chat 路由 profileMgr.getProfile 在 SSE 流创建前调用 — 异常导致 HTTP 500 而非 SSE 错误事件

**ID**: chat-068
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `chat.ts:162-163` 在 `streamSSE(c, ...)` 之前调用 `profileMgr.getProfile(serverId, userId)`。如果 getProfile 抛出异常（数据库错误、profile 损坏等），异常发生在 SSE 流创建之前，Hono 框架会返回 HTTP 500 响应。前端 SSE 客户端收到的是标准 HTTP 错误响应而非 SSE 事件，无法触发 `onError` 回调——用户看到静默失败或浏览器控制台报错。注意：execute 路由（行 441-455）已经在 SSE 流内部正确处理了 getProfile 异常，说明这是一个遗漏，而非设计选择。
**改进方案**:
1. 将 `profileMgr.getProfile` 调用移到 `streamSSE` 回调内部（行 165 之后）
2. 用 try/catch 包裹，失败时通过 `safeWriteSSE` 发送错误事件给前端
3. profile 加载失败后仍可选择无 profile 模式继续对话（降级而非终止）
**验收标准**:
- `getProfile` 异常时前端收到 SSE error 事件（非 HTTP 500）
- 用户看到友好错误消息而非空白/断连
- 现有 chat route 测试通过
- 新增测试：mock getProfile 抛异常，验证 SSE 流仍正确关闭
**影响范围**:
- `packages/server/src/api/routes/chat.ts` — POST `/:serverId` 路由重构
- `packages/server/tests/api/routes/chat.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
