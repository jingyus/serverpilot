### [pending] Skill KV Store — 每个 Skill 的持久化存储 API

**ID**: skill-007
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner.ts:570-574` 中 `store` 工具调用返回占位错误 `"KV store not yet implemented (skill-007)"`；`skill_store` 表已在 schema.ts 中定义并有迁移
**实现方案**:

1. **store.ts** (~120 行):
   - `SkillKVStore` 类: 封装对 `skill_store` 表的 CRUD 操作
   - 方法: `get(skillId, key): Promise<string | null>`, `set(skillId, key, value): Promise<void>`, `delete(skillId, key): Promise<void>`, `list(skillId): Promise<Record<string, string>>`
   - 值大小限制: 单个 value ≤ 1MB (规范要求)
   - 通过 `getSkillRepository()` 或直接使用 Drizzle 查询 `skillStore` 表
   - 单例: `getSkillKVStore()` / `setSkillKVStore()` / `_resetSkillKVStore()`
2. **更新 runner.ts** — `handleStoreTool()` 方法:
   - 替换占位逻辑，改为调用 `getSkillKVStore()` 执行真实 get/set/delete/list 操作
   - action: `get` → 读取, `set` → 写入, `delete` → 删除, `list` → 列出所有 key
3. **store.test.ts** (~150 行):
   - 测试 get/set/delete/list 基本 CRUD 操作
   - 测试 value 大小超限拒绝 (>1MB)
   - 测试 key 不存在返回 null
   - 测试多个 skill 之间的数据隔离
   - 测试 InMemory 实现 (用于 runner 测试)

**验收标准**:
- `store` 工具能在 runner.ts 中正常执行 get/set/delete/list 4 种操作
- 数据持久化到 SQLite `skill_store` 表
- 单值 ≤ 1MB 限制生效
- 不同 skillId 之间数据隔离
- 测试 ≥ 12 个

**影响范围**:
- `packages/server/src/core/skill/store.ts` (新建)
- `packages/server/src/core/skill/store.test.ts` (新建)
- `packages/server/src/core/skill/runner.ts` (修改 — 接入真实 KV store)

**创建时间**: (自动填充)
**完成时间**: -

---
