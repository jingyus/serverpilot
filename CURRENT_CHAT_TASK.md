### [pending] 聊天会话持久化到 SQLite — 消除服务器重启丢失对话的致命问题

**ID**: chat-001
**优先级**: P0
**模块路径**: packages/server/src/core/session/manager.ts, packages/server/src/db/
**发现的问题**:
`SessionManager` 类 (manager.ts:70-176) 使用纯内存 `Map<string, Session>` 存储所有会话数据。服务器重启、进程崩溃或 OOM kill 后，所有聊天记录永久丢失。这是生产环境中最严重的数据丢失风险。

具体问题：
1. `manager.ts:72` — `private sessions = new Map<string, Session>()` 纯内存存储
2. `manager.ts:98-113` — `addMessage()` 只写入 Map，无任何持久化
3. `manager.ts:116-123` — `storePlan()` 同样纯内存
4. 随着对话累积，内存持续增长无上限（无 TTL、无 LRU 淘汰），可能导致 OOM

**改进方案**:
1. 新建 `chat_sessions` 和 `chat_messages` 两张 SQLite 表（Drizzle schema）
2. 创建 `DrizzleSessionRepository` 实现，使用与项目现有模式一致的 Repository + singleton 模式
3. `addMessage()` 同步写入 SQLite；`getSession()` 先查内存缓存再查 DB
4. 保留 `InMemorySessionRepository` 供测试使用
5. 添加迁移脚本 `0009_chat_sessions.sql`
6. 可选：添加 TTL / max-sessions-per-server 限制以防无限增长

**验收标准**:
- 服务器重启后，之前的聊天会话和消息仍可通过 API 查询
- Dashboard 加载历史会话列表正常
- 现有 chat.test.ts 和 session manager 测试全部通过
- 新增 DrizzleSessionRepository 测试覆盖 CRUD + 边界场景
- 无 N+1 查询问题

**影响范围**:
- `packages/server/src/core/session/manager.ts` — 重构为 Repository 接口
- `packages/server/src/db/schema.ts` — 新增表定义
- `packages/server/src/db/repositories/` — 新增 session-repository.ts
- `packages/server/src/db/migrations/` — 新增迁移文件
- `packages/server/src/api/routes/chat.ts` — 使用新的 Repository
- `packages/server/src/core/session/manager.test.ts` — 适配新接口

**创建时间**: 2026-02-12
**完成时间**: -

---
