### [pending] trimMessagesIfNeeded 静默丢弃上下文 — AI 无感知导致幻觉

**ID**: chat-036
**优先级**: P1
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: `trimMessagesIfNeeded()`（第 764-779 行）当消息 token 超过 `MAX_MESSAGES_TOKENS`(150K) 时，从 index 1 开始 splice 删除 assistant/user 消息对。问题：1) 被删除的可能包含关键文件内容（tool_result）或重要执行上下文 2) AI 模型完全不知道部分上下文已丢失，可能基于不完整信息做出错误决策 3) 没有日志记录删除了多少消息/token。
**改进方案**: 1) 在 trim 后注入一条 system message 说明 "Earlier tool results and conversation turns were trimmed to fit context window. {N} messages ({M}K tokens) removed." 2) 添加 debug 级别日志记录 trim 事件 3) 优先保留最近的 tool_result（包含文件内容）而非简单按位置删除。
**验收标准**: 1) trim 后 messages 数组包含一条上下文丢失提示 2) AI 能在后续回复中意识到可能缺失上下文 3) 日志记录 trim 的消息数和 token 数 4) 新增 2+ 测试验证提示注入
**影响范围**: `packages/server/src/ai/agentic-chat.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
