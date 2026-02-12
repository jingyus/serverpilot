### [pending] Store 工具定义缺少 `list` action — AI 无法使用 KV 列表功能

**ID**: skill-014
**优先级**: P0
**模块路径**: packages/server/src/core/skill/runner-tools.ts
**当前状态**: 功能缺失 — `buildToolDefinitions()` 中 `store` 工具的 `action` enum 为 `['get', 'set', 'delete']` (runner-tools.ts:203)，但 `runner.ts:645-648` 的 `executeStore()` 实现了 `list` action。AI 不知道 `list` 操作存在，因此永远不会调用它。规范文档 (SKILL_SPEC.md) 要求 store 工具支持 get/set/delete/list 四种操作
**实现方案**:

1. **runner-tools.ts** — 修改 `buildToolDefinitions()` 中 store 工具:
   - `action.enum`: `['get', 'set', 'delete']` → `['get', 'set', 'delete', 'list']`
   - 更新 `action.description`: 说明 `list` 返回该 Skill 所有键值对
   - `list` 操作不需要 `key` 参数，但 `key` 仍标记为 required — 需改为 optional 或允许 `list` 忽略 `key`
   - 最佳方案: 将 `required` 改为 `['action']`，`key` 和 `value` 都变为 optional；在 runner.ts 中对 `get`/`set`/`delete` 做参数存在性检查
2. **runner.ts** — 在 `executeStore()` 中增加 `key` 缺失检查:
   - `get`/`delete`: 如果 `key` 为空字符串或 undefined → 返回错误
   - `list`: 忽略 `key` 参数 (已实现)
3. **测试**:
   - runner-tools.test.ts (如存在): 验证 store 工具定义包含 `list`
   - runner.test.ts: 新增 `list` 操作测试

**验收标准**:
- AI 可以成功调用 `store` 工具的 `list` action
- `key` 对 `list` 操作不再是必填
- `get`/`set`/`delete` 仍要求 `key`
- 测试覆盖所有 4 种 store 操作

**影响范围**:
- `packages/server/src/core/skill/runner-tools.ts` (修改 — enum + required)
- `packages/server/src/core/skill/runner.ts` (修改 — 参数校验)
- `packages/server/src/core/skill/runner.test.ts` (修改 — 新增 list 测试)

**创建时间**: (自动填充)
**完成时间**: -

---
