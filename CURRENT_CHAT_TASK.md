### [pending] executePlanSteps 中 blocked/step-confirm/AI-summary/auto-diagnosis 四个分支零测试

**ID**: chat-047
**优先级**: P2
**模块路径**: packages/server/src/api/routes/chat-execution.ts
**发现的问题**: `executePlanSteps()` 内部多个重要分支未测试：1) 第 342-353 行 — `blocked` 命令处理（emit step_start + BLOCKED output + step_complete → break） 2) 第 356-378 行 — step-confirm 模式（reject → break, allow_all → skip 后续确认） 3) 第 477-508 行 — 执行后 AI 摘要生成（summaryPrompt 构建、streaming、错误处理） 4) 第 430-444/455-463 行 — 步骤失败后 auto-diagnosis SSE 事件。
**改进方案**: 在 `chat-execution.test.ts` 新增专门的 `executePlanSteps` 集成测试 describe 块，mock executor 返回不同结果，验证每个分支的 SSE 事件输出序列。
**验收标准**: 1) blocked 路径有测试（验证 SSE 事件序列） 2) step-confirm allow/reject/allow_all 有测试 3) AI summary 生成有测试 4) auto-diagnosis 集成有测试 5) 新增 8+ 测试用例
**影响范围**: `packages/server/src/api/routes/chat-execution.test.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
