### [pending] listSessions 加载全部消息仅取 lastMessage — N+1 查询性能问题

**ID**: chat-037
**优先级**: P1
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `listSessions()`（第 340-358 行）调用 `this.repo.listByServer()` 获取所有 session，然后对每个 session 的 `messages` 做 `map(toChatMessage)` 转换全部消息，仅为了取 `messages[messages.length - 1]?.content.slice(0, 100)` 作为 `lastMessage`。对于有 100 个 session、每个 session 平均 50 条消息的服务器，这意味着加载和转换 5000 条消息对象，仅使用其中 100 条的前 100 字符。
**改进方案**: 1) 在 `SessionRepository` 接口添加 `listSummaries()` 方法，在 SQL 层只查询 session 元数据 + 最后一条消息 2) 使用子查询或 window function 获取 lastMessage 3) DrizzleSessionRepository 实现中用 `SELECT ... (SELECT content FROM messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_message`。
**验收标准**: 1) listSessions 不再加载全部消息 2) SQL 查询数量从 N+1 降为 1 3) 返回结果格式不变 4) 新增性能测试验证改进
**影响范围**: `packages/server/src/core/session/manager.ts`, `packages/server/src/core/session/repository.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
