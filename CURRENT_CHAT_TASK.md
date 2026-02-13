### [pending] 前端 Agentic 模式无工具调用摘要 — 用户看不到 AI 执行了哪些命令及结果

**ID**: chat-093
**优先级**: P2
**模块路径**: packages/dashboard/src/
**发现的问题**: Agentic 模式下 `toolCalls` 数组在 `chat-types.ts:41-46` 定义并在 `chat-sse-handlers.ts` 的 `onToolCall/onToolExecuting/onToolOutput/onToolResult` 中更新，但 `Chat.tsx` 和 `MessageListFooter` 中 `toolCalls` 状态从未被渲染。用户在 agentic 模式下只能看到 AI 的文本输出，看不到：(1) AI 执行了哪些命令 (2) 每个命令的状态（运行中/成功/失败） (3) 命令的输出内容。`streamingContent` 中虽然包含 AI 的文本描述，但如果 AI 不主动描述，用户对后台发生的操作一无所知。
**改进方案**: 在 `MessageListFooter` 中当 `isAgenticMode && toolCalls.length > 0` 时渲染一个 `ToolCallList` 组件，显示每个工具调用的命令、状态图标、可折叠的输出。类似 Claude.ai 的"工具调用"展开面板。
**验收标准**: (1) Agentic 模式下实时显示工具调用列表 (2) 每个调用显示命令/状态/耗时 (3) 输出可折叠展开 (4) 运行中的调用显示 spinner
**影响范围**: `packages/dashboard/src/pages/Chat.tsx`, 新增 `packages/dashboard/src/components/chat/ToolCallList.tsx`
**创建时间**: 2026-02-13
**完成时间**: -

---
