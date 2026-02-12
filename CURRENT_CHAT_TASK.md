### [pending] TokenTracker 内存无上限增长 — 长运行服务器必定 OOM

**ID**: chat-035
**优先级**: P0
**模块路径**: packages/server/src/ai/token-tracker.ts
**发现的问题**: `TokenTracker.entries` 数组（第 143 行）只有 `push()` 没有任何淘汰机制。`record()` 方法（第 154 行）每次 AI 调用都追加条目。对于长时间运行的生产服务器，假设每分钟 10 次 AI 调用，每天 14,400 条 × 每条约 200 字节 = 每天 ~3MB，一个月 ~90MB 纯 entries 数组。`reset()` 方法（第 267 行）标注为测试用途。`getStats()` 和 `getStatsBySession()` 每次调用都遍历全量 entries。
**改进方案**: 1) 添加 `maxEntries` 配置（默认 10000） 2) `record()` 时检查长度，超出则移除最旧 entries 3) 可选：按 sessionId 分桶，evict 最旧 session 的所有 entries 4) 添加 `prune(olderThanMs)` 方法供定时清理。
**验收标准**: 1) entries 数组有上限，不再无限增长 2) 超出上限时自动淘汰旧条目 3) getStats 仍返回正确的近期统计 4) 新增 3+ 测试覆盖淘汰行为
**影响范围**: `packages/server/src/ai/token-tracker.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
