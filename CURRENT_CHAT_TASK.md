### [pending] session/manager.ts 超过 500 行软限制 — 715 行可提取缓存和重试队列逻辑

**ID**: chat-060
**优先级**: P2
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: manager.ts 当前 715 行，超出 500 行软限制 215 行。文件包含：(1) 类型定义（第 30-80 行）; (2) 缓存配置和 CacheEntry（第 82-130 行）; (3) SessionManager 类（第 132-700 行，含 LRU 缓存管理、重试队列、上下文构建、持久化等多个职责）; (4) 单例管理（第 702-715 行）。SessionManager 类承担了过多职责，违反单一职责原则。
**改进方案**: 提取以下独立模块：(1) `session-cache.ts` — LRU 缓存逻辑（get/set/evict/sweep/protect），约 150 行; (2) `session-retry-queue.ts` — 重试队列处理逻辑（processRetryQueue/markMessagePersisted），约 80 行。主文件保留 SessionManager 公共 API 和编排逻辑，约 480 行。
**验收标准**: (1) manager.ts 降至 500 行以内; (2) 拆分后模块独立可测试; (3) 所有现有测试通过; (4) SessionManager 公共 API 不变
**影响范围**: packages/server/src/core/session/manager.ts, 新文件 session-cache.ts, session-retry-queue.ts
**创建时间**: (自动填充)
**完成时间**: -

---
