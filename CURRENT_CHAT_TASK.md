### [pending] addMessage 在 cache eviction 后抛异常 — 高并发下用户丢消息

**ID**: chat-038
**优先级**: P1
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `addMessage()`（第 285-311 行）在第 292 行检查 `this.cache.get(sessionId)`，如果返回 null 则抛出 `Error('Session ${sessionId} not found')`。但在高负载场景下，用户调用 `getOrCreate()` 后 session 进入 cache，若在 `addMessage()` 调用前另一个请求触发了 `evictIfNeeded()`（第 174-204 行），该 session 可能已被 LRU 驱逐。此时用户会收到 500 错误，且消息丢失。`evictIfNeeded` 虽然保护 active session（`plans.size > 0`），但普通聊天 session 无 plan 时不受保护。
**改进方案**: `addMessage()` 在 cache miss 时不抛异常，而是自动从 DB 重新加载 session（调用 `loadSessionFromDb`），然后继续添加消息。添加 `cache_reload` 计数器监控此场景频率。
**验收标准**: 1) cache miss 时自动 reload，用户无感知 2) 消息不再丢失 3) 新增测试：evict session 后 addMessage 仍成功 4) 日志记录 reload 事件
**影响范围**: `packages/server/src/core/session/manager.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
