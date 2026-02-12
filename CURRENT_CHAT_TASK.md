### [pending] 会话内存缓存无驱逐机制 — 长期运行服务器内存持续增长

**ID**: chat-018
**优先级**: P2
**模块路径**: packages/server/src/core/session/manager.ts
**发现的问题**: `manager.ts:103` 的 `private cache = new Map<string, Session>()` 在 `getOrCreate()` 和 `getSession()` 时填充，但除了 `deleteSession()` 外无任何驱逐机制。每个 Session 对象包含完整的 `messages[]` 数组和 `plans: Map`。服务器持续运行时，所有曾被访问的会话永久驻留内存。100 个用户各 10 个会话，每个会话 50 条消息，可能消耗数百 MB 内存。
**改进方案**: 
1. 添加 LRU 驱逐策略：最多缓存 100 个会话（可配置），超限时淘汰最久未访问的
2. 或添加 TTL：会话 30 分钟未访问从缓存移除（DB 中仍保留）
3. 使用 `updatedAt` 时间戳排序，驱逐时将 dirty 数据刷回 DB
4. 保留 `plans` 在缓存驱逐时的处理（plans 是纯内存的，驱逐后丢失——需记录警告或拒绝驱逐活跃执行的会话）
**验收标准**: 
- 缓存大小有上限，超限时自动驱逐
- 驱逐后的会话再次访问时从 DB 重新加载
- 活跃执行中的会话不被驱逐
- 新增测试覆盖缓存驱逐和重新加载
**影响范围**: packages/server/src/core/session/manager.ts
**创建时间**: (自动填充)
**完成时间**: -

---
