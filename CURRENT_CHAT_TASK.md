### [pending] sessionLocks 超时后残留 — 30s 超时不清理 Map 条目导致后续请求永远等待

**ID**: chat-085
**优先级**: P0
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `acquireSessionLock()` (chat.ts:87-109) 中 `Promise.race([currentLock, timeout])` 超时后只是 resolve，不会从 `sessionLocks` Map 中删除旧条目（行 106 的 `sessionLocks.delete(sessionId)` 只在 release 函数中调用）。如果请求 A 挂起超过 30s 且永远不释放锁（例如 SSE 流因网络问题卡住），请求 B 超时后继续执行并设置新锁，但请求 A 的旧锁仍在 Map 中指向的 Promise 永远不会 resolve。虽然请求 B 覆盖了 Map 中的值（行 100），但如果请求 A 最终释放，它会删除请求 B 的锁条目（行 106），导致请求 C 不等待请求 B 就直接执行。
**改进方案**: 超时时主动 `sessionLocks.delete(sessionId)` 清理旧条目，并用 `logger.warn` 记录超时事件。同时在 `releaseFn` 中检查当前 Map 中的值是否仍然是自己的 Promise（避免删除他人的锁）。
**验收标准**: (1) 超时后旧锁条目被清理 (2) release 不会误删其他请求的锁 (3) 超时事件被日志记录 (4) 新增测试验证超时场景
**影响范围**: `packages/server/src/api/routes/chat.ts`, `packages/server/src/api/routes/chat.test.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
