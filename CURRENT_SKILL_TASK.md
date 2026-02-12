### [pending] runner-executor.test.ts — 6 种工具执行器单元测试 + 安全审计验证

**ID**: skill-024
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `runner-executor.ts` (414 行) 实现了 `executeShell`、`executeReadFile`、`executeWriteFile`、`executeNotify`、`executeHttp`、`executeStore` 六个工具执行方法，以及 `auditShell` 审计辅助函数。这些是 Skill 命令执行的最终出口，涉及安全分级 (`classifyCommand`)、审计日志 (`getAuditLogger`)、Agent 通信 (`getTaskExecutor`)，完全无测试覆盖
**实现方案**:
创建 `runner-executor.test.ts`，Mock 外部依赖 (TaskExecutor, AuditLogger, WebhookDispatcher, SkillKVStore, Agent):
1. **executeShell** (~10 tests):
   - 正常执行: command → classifyCommand → 安全通过 → Agent 执行 → 返回 stdout
   - 安全拒绝: red 命令 + yellow max → isError=true + blocked 消息
   - forbidden 命令永远拒绝
   - 审计日志: 每次 shell 调用都记录到 auditLogger
   - Agent 未连接: 返回错误信息
2. **executeReadFile** (~3 tests): 路径正常/Agent 错误/空文件
3. **executeWriteFile** (~3 tests): 写入成功/Agent 错误/空内容
4. **executeNotify** (~3 tests): 正常分发/dispatcher 异常/缺少参数
5. **executeHttp** (~4 tests): GET/POST 成功, 超时, 非 200 响应
6. **executeStore** (~4 tests): get/set/delete/list 操作
7. **auditShell** (~2 tests): 记录格式正确, 包含 skillId/serverId/command
**验收标准**:
- 测试 ≥ 28 个，覆盖所有 6 种执行器 + 审计函数
- 安全相关测试验证 `classifyCommand()` 与 `exceedsRiskLimit()` 的联动
- `pnpm vitest run packages/server/src/core/skill/runner-executor.test.ts` 全部通过
**影响范围**:
- `packages/server/src/core/skill/runner-executor.test.ts` (新建)
**创建时间**: (自动填充)
**完成时间**: -

---
