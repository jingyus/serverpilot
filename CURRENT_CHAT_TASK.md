### [pending] Agentic 工具输入验证失败时前端无感知 — 只返回错误给 AI 不发 SSE

**ID**: chat-064
**优先级**: P2
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 第 398-430 行的 `executeToolCall()` 中，当 `ExecuteCommandInputSchema.safeParse(input)` 等 Zod 验证失败时，只返回错误字符串给 AI（如 `"Error: Invalid tool input for execute_command: ..."`），但不发送任何 SSE 事件通知前端。前端无法知道 AI 生成了无效的工具调用。这可能导致 AI 反复重试无效输入，用户只看到 AI 在"思考"但没有任何进展反馈。
**改进方案**: 在验证失败时发送 `tool_result` SSE 事件（status: 'validation_error'），让前端展示具体的验证错误信息。同时记录 warn 日志帮助调试。
**验收标准**: (1) 工具输入验证失败时前端收到 tool_result 事件; (2) 前端可展示验证错误信息; (3) 日志记录验证失败详情
**影响范围**: packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
