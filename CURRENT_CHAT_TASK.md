### [pending] agentic-chat.ts 超出 800 行硬限制 — 844 行需要拆分

**ID**: chat-053
**优先级**: P0
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: agentic-chat.ts 当前 844 行，超出 800 行硬限制 44 行。文件包含：(1) 工具定义和 Schema（第 30-119 行，约 90 行）; (2) AgenticChatEngine 类（第 163-702 行，约 540 行）; (3) buildAgenticSystemPrompt 函数（第 704-734 行，约 30 行）; (4) 消息裁剪工具函数（第 736-826 行，约 90 行）; (5) 单例管理（第 828-843 行）。
**改进方案**: 将以下部分提取到独立文件：(1) `agentic-tools.ts` — 工具定义、输入 Schema（ExecuteCommandInputSchema 等）; (2) `agentic-prompts.ts` — buildAgenticSystemPrompt 函数; (3) `agentic-message-utils.ts` — extractBlockText、estimateMessageTokens、trimMessagesIfNeeded。主文件保留 AgenticChatEngine 类和单例管理，约 550 行。
**验收标准**: (1) agentic-chat.ts 降至 600 行以内; (2) 拆分后的文件各不超过 200 行; (3) 所有现有测试通过; (4) 导入路径正确
**影响范围**: packages/server/src/ai/agentic-chat.ts, 新文件 agentic-tools.ts, agentic-prompts.ts, agentic-message-utils.ts
**创建时间**: (自动填充)
**完成时间**: -

---
