### [pending] fire-and-forget persistMessage 双重失败时用户无感知 — 消息静默丢失

**ID**: chat-048
**优先级**: P1
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `persistMessage()`（第 502-525 行）在第一次 DB 写入失败后重试一次，如果再次失败仅 `logger.error` 记录，不抛异常也不通知调用方。`addMessage()`（第 307-308 行）以 fire-and-forget 方式调用 `persistMessage`（无 await、无 .catch），意味着消息仅存在于内存 cache。如果此后 session 被 evict 或服务器重启，该消息永久丢失。用户看到消息已发送（因为内存中存在），但刷新页面后消息消失。
**改进方案**: 1) `addMessage()` 返回的 `ChatMessage` 增加 `persisted: boolean` 字段 2) `persistMessage` 失败时将消息标记为 `persisted: false` 3) 定期扫描未持久化消息并重试（write-behind pattern） 4) 前端可选展示 "消息可能未保存" 状态图标。或更简单：对用户消息使用 await persistMessage（只有 AI 流式响应用 fire-and-forget）。
**验收标准**: 1) 用户发送的消息（role=user）同步持久化 2) AI 响应可异步持久化但有重试队列 3) 持久化失败有告警日志 + 前端提示 4) 新增测试验证双重失败后消息仍可通过重试队列恢复
**影响范围**: `packages/server/src/core/session/manager.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
