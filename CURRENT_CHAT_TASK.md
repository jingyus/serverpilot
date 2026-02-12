### [pending] 会话消息持久化静默失败 — DB 写入错误被吞没无日志

**ID**: chat-009
**优先级**: P0
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `manager.ts:165-168` 的 `addMessage()` 使用 fire-and-forget 模式写入 SQLite，`.catch(() => {})` 完全吞没错误且注释 "log silently handled" 是误导——实际无任何日志记录。磁盘满、SQLite 锁冲突等场景下消息仅存于内存缓存，服务器重启即永久丢失。用户无感知数据丢失是最危险的静默故障。
**改进方案**: 
1. `.catch()` 中添加 `logger.error('Failed to persist message', { sessionId, error })` 日志
2. 添加简单的重试机制（1 次重试，间隔 500ms）
3. 可选：在连续 N 次持久化失败后通过 SSE 发送 `warning` 事件通知前端
4. 确保不阻塞 SSE 流式响应（保持异步）
**验收标准**: 
- DB 写入失败时控制台有 error 级别日志，包含 sessionId 和错误详情
- 至少 1 次重试后失败才放弃
- SSE 流式响应不被持久化操作阻塞
- 新增测试：模拟 repo.addMessage 抛异常，验证日志记录和重试
**影响范围**: packages/server/src/core/session/manager.ts
**创建时间**: (自动填充)
**完成时间**: -

---
