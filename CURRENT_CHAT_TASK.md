### [pending] addMessage 全量读写消息数组 — 每次追加消息读取并重写全部历史导致 O(n) 性能退化

**ID**: chat-081
**优先级**: P0
**模块路径**: packages/server/src/db/repositories/session-repository.ts
**发现的问题**: `DrizzleSessionRepository.addMessage()` (行 239-255) 每次追加一条消息时先调用 `this.getById(id, userId)` 加载整个 session（包含所有历史消息的 JSON 数组），然后 `[...existing.messages, message]` 构造新数组并整体覆盖写回。对于 1000 条消息的会话，每次追加都需要解析和序列化整个 JSON 数组。`updateContext`、`updateName`、`delete` 也使用同样的 `getById` 前置查询模式（行 262、275、288）。这对高频对话场景（agentic 模式每轮 2-3 条消息）性能极差。
**改进方案**: 将 messages 从 JSON 列拆分为独立的 `session_messages` 表（id, session_id, role, content, timestamp, persisted），`addMessage` 变为简单的 INSERT。`getById` 通过 JOIN 或子查询加载消息。需要新建 migration 文件创建表并迁移现有数据。
**验收标准**: (1) addMessage 为 O(1) INSERT 操作 (2) getById 仍返回完整消息列表 (3) 现有测试全部通过 (4) 新增 migration 可正确迁移旧数据
**影响范围**: `packages/server/src/db/repositories/session-repository.ts`, `packages/server/src/db/schema.ts`, 新 migration SQL 文件
**创建时间**: 2026-02-13
**完成时间**: -

---
