### [pending] 后端 session API 无重命名端点 — 缺少 PATCH /sessions/:id 支持前端会话重命名

**ID**: chat-075
**优先级**: P2
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `chat.ts:511-560` 定义了 sessions 的 GET（列表）、GET（详情）、DELETE 端点，但缺少 PATCH/PUT 端点用于更新会话元数据（标题/名称）。`SessionManager` 和底层 `SessionRepository` 也无 `updateSession` 或 `renameSession` 方法。sessions 数据库表（`chat_sessions`）是否有 `title` 列需确认。此为前端会话重命名功能（chat-074）的后端依赖。
**改进方案**:
1. 数据库层：确认 `chat_sessions` 表有 `title` 列，如无则添加 migration
2. `SessionRepository` 添加 `updateTitle(sessionId, userId, title)` 方法
3. `SessionManager` 添加 `renameSession(sessionId, userId, title)` 方法
4. 添加 `PATCH /chat/:serverId/sessions/:sessionId` 路由，body: `{ title: string }`
5. Zod schema 验证 title 长度（1-100 字符）
**验收标准**:
- PATCH 端点正常工作，返回 `{ success: true }`
- 标题持久化到数据库
- 权限检查：只能重命名自己的会话
- listSessions 返回值包含 title 字段
- 路由测试覆盖
**影响范围**:
- `packages/server/src/api/routes/chat.ts` — 新增 PATCH 路由
- `packages/server/src/core/session/manager.ts` — 新增 renameSession
- `packages/server/tests/api/routes/chat.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
