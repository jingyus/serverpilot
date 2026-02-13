### [pending] RetryQueue 无队列上限 — DB 长时间故障时内存无限增长

**ID**: chat-084
**优先级**: P0
**模块路径**: packages/server/src/core/session/
**发现的问题**: `RetryQueue.enqueue()` (session-retry-queue.ts:65-67) 直接 `this.queue.push(entry)` 无任何上限检查。当 SQLite 数据库不可用时（磁盘满、文件锁等），所有异步消息持久化都会失败并入队。按每条消息 ~500 字节估算，如果 DB 故障持续 1 小时、100 msg/s 的场景下，队列将积累 360,000 条目（~180MB）。目前唯一的保护是 `maxRetryAttempts=5`（每 5 秒处理一次），但在 DB 完全不可用时 5 次重试都会失败，清除旧条目的同时新条目持续涌入。
**改进方案**: 在 `RetryQueueOptions` 增加 `maxQueueSize`（默认 10,000）。`enqueue` 超限时丢弃最旧条目并触发 `_onPersistenceFailure` 回调。添加 `queueFullCount` 指标用于监控。
**验收标准**: (1) 队列大小永远不超过 maxQueueSize (2) 超限时触发 onPersistenceFailure 回调并打日志 (3) 新增单元测试验证上限行为 (4) 现有测试不受影响
**影响范围**: `packages/server/src/core/session/session-retry-queue.ts`, `packages/server/src/core/session/session-retry-queue.test.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
