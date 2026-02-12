### [pending] server 端 chat.ts 路由文件超 800 行硬限制 — `any` 类型逃逸需修复

**ID**: chat-020
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat.ts
**发现的问题**: 
1. `chat.ts` 当前 873 行，超出 800 行硬限制
2. `chat.ts:101-104` 定义了 `type StoredPlan = any` 和 `type ServerProfile = any`（带 eslint-disable），完全绕过 TypeScript 类型检查。`executePlanSteps` 函数（114-369，共 255 行）内所有 `plan.steps`、`step.id`、`step.command` 等访问都无类型安全
3. `executePlanSteps` 单独就有 255 行，应提取为独立模块
**改进方案**: 
1. 将 `executePlanSteps` 提取到 `api/routes/chat-execution.ts`
2. 为 `StoredPlan` 和 `ServerProfile` 定义真正的 TypeScript 接口（参考 shared 中已有的 PlanStep schema）
3. 消除所有 `any` 类型逃逸
4. 主 `chat.ts` 只保留路由注册和请求处理
**验收标准**: 
- `chat.ts` 降至 500 行以内
- 不再有 `any` 类型别名
- `executePlanSteps` 中所有属性访问有类型检查
- TypeScript 编译无 `@ts-ignore` 或 `eslint-disable`
**影响范围**: packages/server/src/api/routes/chat.ts, packages/server/src/api/routes/chat-execution.ts (新)
**创建时间**: (自动填充)
**完成时间**: -


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
**完成时间**: 2026-02-12 22:04:06

---
