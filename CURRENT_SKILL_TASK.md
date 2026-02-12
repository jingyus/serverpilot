### [pending] runner.ts 超 500 行限制 — 提取工具执行方法到独立模块

**ID**: skill-017
**优先级**: P2
**模块路径**: packages/server/src/core/skill/runner.ts
**当前状态**: 需要改进 — `runner.ts` 当前 677 行，超过项目标准的 500 行软限制。文件包含 SkillRunner 核心循环 + 6 种工具执行方法 (shell/read_file/write_file/notify/http/store) + 审计方法 + helper 方法。工具执行逻辑可独立提取
**实现方案**:

1. **新建 `runner-executor.ts`** (~250 行):
   - 提取 6 个 `execute*` 方法 + `auditShell` 方法为独立类 `SkillToolExecutor`:
     - `executeShell()`, `executeReadFile()`, `executeWriteFile()`, `executeNotify()`, `executeHttp()`, `executeStore()`
     - `auditShell()` 辅助方法
   - 构造参数: 接收所需依赖 (taskExecutor, auditLogger, webhookDispatcher 等)
   - 导出 `SkillToolExecutor` 类
2. **修改 `runner.ts`** (~350 行):
   - 移除工具执行方法，改为实例化 `SkillToolExecutor` 并调用
   - 保留核心 agentic loop 逻辑
3. **测试**:
   - 现有 runner.test.ts 无需大改 (接口不变)
   - 可选: 新增 runner-executor.test.ts 对工具执行方法做独立单元测试

**验收标准**:
- `runner.ts` 降至 ≤ 500 行
- `runner-executor.ts` ≤ 300 行
- 所有现有 runner.test.ts 测试继续通过
- 无行为变化，纯重构

**影响范围**:
- `packages/server/src/core/skill/runner.ts` (修改 — 拆分)
- `packages/server/src/core/skill/runner-executor.ts` (新建)
- `packages/server/src/core/skill/runner.test.ts` (可能微调 import)

**创建时间**: (自动填充)
**完成时间**: -

---
