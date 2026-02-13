### [pending] SkillKVStore 批量清除接口 — 支持按 skillId 清除所有 KV 条目

**ID**: skill-104
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: `SkillKVStoreInterface` 只有 `get/set/delete/list` 四个方法，缺少 `deleteAll(skillId)` 批量删除方法。虽然 DB 层有 `ON DELETE CASCADE` 在卸载时自动清理，但无法在不卸载 Skill 的情况下重置其存储状态 (比如重新配置后需要清除旧数据)。
**实现方案**: 
1. 在 `SkillKVStoreInterface` 中添加 `deleteAll(skillId: string): Promise<number>` 方法
2. `SkillKVStore` (Drizzle 实现): `DELETE FROM skill_store WHERE skill_id = ?`，返回删除行数
3. `InMemorySkillKVStore` (测试实现): 过滤 Map 中 skillId 匹配的条目
4. `runner-tools.ts` 的 `store` tool 可选添加 `store_clear` 子操作 (让 AI 可以在 Skill 执行中清除旧数据)
5. 在 `store.test.ts` 中添加 `deleteAll` 测试用例
**验收标准**: 
- Interface 添加 `deleteAll` 方法
- 两种实现均正确
- ≥3 个测试用例 (正常删除、空存储、验证返回计数)
**影响范围**: packages/server/src/core/skill/store.ts, packages/server/src/core/skill/store.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
