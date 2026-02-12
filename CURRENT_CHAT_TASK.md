### [pending] Agentic confirm 超时、legacy confirm 成功路径、step-decision 成功路径零测试

**ID**: chat-046
**优先级**: P1
**模块路径**: packages/server/src/api/routes/chat.ts, chat-execution.ts
**发现的问题**: 三个关键用户交互流程缺少测试：1) `chat.ts` 第 141-144 行 — agentic confirm 的 5 分钟超时 auto-reject（`setTimeout` → `resolve(false)`），仅测了 404 路径 2) `chat.ts` POST confirm 路由第 336-351 行的成功路径（找到 pending → clearTimeout → resolve → delete）从未被测试 3) `chat-execution.ts` POST step-decision 第 140-152 行 `resolveStepDecision()` 成功路径未被测试。
**改进方案**: 在 `chat.test.ts` 中补充：1) 设置 pending confirmation → 等待超时 → 验证 resolve(false) 2) 设置 pending confirmation → POST confirm → 验证 resolve(true) + 清理 3) 在 `chat-execution.test.ts` 中补充 waitForStepDecision + resolveStepDecision 集成测试。
**验收标准**: 1) confirm 超时路径有测试 2) confirm 成功路径有测试 3) step-decision 成功路径有测试 4) 新增 6+ 测试用例
**影响范围**: `packages/server/src/api/routes/chat.test.ts`, `chat-execution.test.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
