### [pending] Skill KV Store 总量限制 — 防止单个 Skill 占满数据库

**ID**: skill-077
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: `store.ts` 仅有单值 1MB 限制，无每 Skill 键数量或总存储量上限。一个 Skill 可以创建无限键值对填满数据库。
**实现方案**: 
1. 在 `store.ts` 添加常量:
   - `MAX_KEYS_PER_SKILL = 1000` — 每个 Skill 最多 1000 个键
   - `MAX_TOTAL_SIZE_PER_SKILL = 50 * 1024 * 1024` (50MB) — 每个 Skill 总存储上限
2. 在 `set()` 方法中:
   - 调用 `countKeys(skillId)` 检查键数量
   - 如果是新键且已达上限 → 抛出 `SkillStoreQuotaError`
3. Drizzle 实现: `SELECT COUNT(*) FROM skill_store WHERE skill_id = ?`
4. InMemory 实现: Map.size 检查
5. 对应测试
**验收标准**: 
- 超过 1000 键时 set() 抛出错误
- 更新已有键不受键数限制影响
- 测试覆盖: ≥6 个测试用例
**影响范围**: packages/server/src/core/skill/store.ts, packages/server/src/core/skill/store.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
