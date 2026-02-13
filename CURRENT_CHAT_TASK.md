### [pending] listSessions 硬编码 limit=100 无分页 — 超过 100 个会话的服务器丢失历史

**ID**: chat-082
**优先级**: P0
**模块路径**: packages/server/src/core/session/
**发现的问题**: `SessionManager.listSessions()` (manager.ts:287-301) 硬编码 `limit: 100, offset: 0`，无法获取第 100 个之后的会话。前端 `SessionSidebar` 会话列表不支持加载更多（chat-sessions.ts:20-34 的 `createFetchSessions` 无分页参数）。活跃用户在同一服务器上长期使用后会积累超过 100 个会话，旧会话永远无法在 UI 中显示。
**改进方案**: `listSessions` 增加 `limit` 和 `offset` 参数（保持向后兼容的默认值）。API 响应增加 `total` 字段。前端暂不改（下一个任务处理）。
**验收标准**: (1) `listSessions(serverId, userId, { limit, offset })` 支持分页 (2) 返回值增加 `total` 字段 (3) GET /sessions API 支持 `?limit=&offset=` 查询参数 (4) 默认值保持 100 以兼容现有前端
**影响范围**: `packages/server/src/core/session/manager.ts`, `packages/server/src/api/routes/chat.ts`
**创建时间**: 2026-02-13
**完成时间**: -

---
