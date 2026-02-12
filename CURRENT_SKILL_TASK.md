### [pending] runner.test.ts 拆分 — 1240 行超出 800 行硬限制

**ID**: skill-069
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: `runner.test.ts` 1240 行，超出硬限制 55%。包含 3 个顶层 describe: `parseTimeout` (L174)、`buildToolDefinitions` (L203)、`SkillRunner` (L244)。其中 `SkillRunner` 块占约 1000 行，是主要的 AI agentic loop 测试。
**实现方案**: 
1. 将 `parseTimeout` 和 `buildToolDefinitions` 测试已经在 `runner-tools.test.ts` (225 行) 中有独立覆盖 — 从 `runner.test.ts` 中删除这两个 describe 块（约 70 行），避免重复
2. 将 `SkillRunner` 按场景拆分: 创建 `runner-agentic-loop.test.ts` — 提取 AI 循环多步骤、超时、max_steps、SSE 事件发布等测试（约 500 行）
3. 原 `runner.test.ts` 保留基础运行、单步执行、安全拒绝、错误处理（约 650 行）
**验收标准**: 
- `runner.test.ts` ≤ 700 行
- `runner-agentic-loop.test.ts` ≤ 600 行
- 无重复测试（删除与 runner-tools.test.ts 重叠的用例）
- 所有测试仍通过
**影响范围**: packages/server/src/core/skill/runner.test.ts, packages/server/src/core/skill/runner-agentic-loop.test.ts (新)
**创建时间**: (自动填充)
**完成时间**: -

---
