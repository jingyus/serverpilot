### [pending] Agentic tool_use input 缺少运行时验证 — AI 返回畸形输入可导致命令注入

**ID**: chat-033
**优先级**: P0
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: `executeToolCall()` 在第 394、401、407 行对 AI 返回的 tool `input` 直接使用 `as` 类型断言，无任何运行时验证。例如第 394 行 `input as { command: string; description: string; timeout_seconds?: number }` — 如果 Claude 返回 `{ command: 123 }` (number 而非 string)，后续 `toolExecuteCommand` 会将 `123` 传入 shell 执行。更严重的是，如果 `command` 字段缺失，`undefined` 会被传入命令调度器。
**改进方案**: 为每个 tool 的 input 定义 Zod schema（`ExecuteCommandInputSchema`、`ReadFileInputSchema`、`ListFilesInputSchema`），在 `executeToolCall` 的 switch 分支中先 `safeParse`，失败则返回 `Error: Invalid tool input: ${issues}` 给 AI 进行自我修正，不实际执行命令。
**验收标准**: 1) 所有 tool input 经过 Zod 验证后才执行 2) 畸形 input 返回描述性错误字符串而非崩溃 3) 新增 3+ 测试覆盖畸形 input 场景 4) 无 `as` 类型断言用于 tool input
**影响范围**: `packages/server/src/ai/agentic-chat.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
