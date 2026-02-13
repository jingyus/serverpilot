### [pending] chat 路由并发请求同 session 无互斥 — 消息顺序错乱和重复 AI 处理

**ID**: chat-073
**优先级**: P1
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `chat.ts:112-364` POST `/:serverId` 路由无任何并发控制。当两个请求携带相同 `sessionId` 同时到达时：(1) 两者都调用 `getOrCreate`（行 153）获得同一 session；(2) 两者都调用 `addMessage`（行 156）添加 user 消息——消息顺序取决于 event loop 调度；(3) 两者都启动 AI 处理（行 180 或 290）——AI 收到两个不同用户消息的上下文；(4) 两者都写回 assistant 消息（行 203 或 309）——对话历史变为 user-user-assistant-assistant 交错。前端虽有重入保护（chat-010 已修复），但网络延迟或浏览器多 tab 场景仍可能触发。
**改进方案**:
1. 添加 per-session 锁机制：`sessionLocks: Map<sessionId, Promise<void>>`
2. 每个 chat 请求先 await 当前 session 的锁 Promise，然后设置新锁
3. 锁在 SSE 流完成（finally 块）后释放
4. 实现为简单的串行队列：后到的请求等前一个完成后再处理
5. 添加超时保护（30s），避免死锁
**验收标准**:
- 同一 session 的 chat 请求串行处理
- 不同 session 的请求不受影响（并行）
- 锁超时后自动释放（不死锁）
- 现有 chat route 测试通过 + 新增并发测试
**影响范围**:
- `packages/server/src/api/routes/chat.ts` — 添加 session 锁
- `packages/server/tests/api/routes/chat.test.ts` — 新增并发测试
**创建时间**: 2026-02-13
**完成时间**: -

---
