### [pending] agentic-chat.ts 超出 800 行硬限制（911 行）— 工具实现方法需提取到独立模块

**ID**: chat-090
**优先级**: P0
**模块路径**: packages/server/src/ai/
**发现的问题**: `agentic-chat.ts` 当前 911 行，严重超出 800 行硬限制。主要体积来自三个工具实现方法 `toolExecuteCommand`（572-767 行，约 196 行）、`toolReadFile`（772-795 行）、`toolListFiles`（800-823 行），加上 `handleValidationError`（538-567 行）。这些方法与 AgenticChatEngine 的核心循环逻辑（`run`/`streamAnthropicCall`）职责不同，属于工具执行层，应独立为模块。
**改进方案**: 创建 `agentic-tool-executors.ts`，将 `toolExecuteCommand`、`toolReadFile`、`toolListFiles`、`handleValidationError` 提取为独立函数或类。每个函数接收必要参数（serverId, userId, sessionId, clientId, stream, abort 等），不再需要作为 AgenticChatEngine 的私有方法。`shellEscape` 工具函数一并迁移。`AgenticChatEngine.executeToolCall` 保留为路由方法，调用提取后的执行器。
**验收标准**: `agentic-chat.ts` 行数 ≤ 500；`agentic-tool-executors.ts` 行数 ≤ 400；所有现有 agentic-chat 测试通过；新模块有独立测试文件
**影响范围**: `packages/server/src/ai/agentic-chat.ts`、新建 `packages/server/src/ai/agentic-tool-executors.ts`
**创建时间**: (自动填充)
**完成时间**: -

---
