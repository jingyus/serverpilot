### [pending] agentic-chat.ts 的 trimMessagesIfNeeded 算法有 token 估算累减偏差

**ID**: chat-022
**优先级**: P0
**模块路径**: packages/server/src/ai/agentic-chat.ts
**发现的问题**: `agentic-chat.ts:748-765` 的 `trimMessagesIfNeeded()` 使用 `currentTokens -= removedTokens` 累减方式计算剩余 token 数。但 `estimateMessagesTokens()` 对不同消息类型（string content vs structured tool_use/tool_result blocks）的估算精度不同，累减多次后误差会放大。更关键的是：`agentic-chat.ts:37` 使用 `CHARS_PER_TOKEN = 4` 常量做 ASCII 估算，而项目已在 task-012 中修复了 `profile-context.ts:estimateTokens()` 支持 CJK 混合文本。此处是独立的实现，未复用已修复的 `estimateTokens`。当中文对话达到 20+ turns 时，150K token 预算（`agentic-chat.ts:34`）实际可能允许 600K+ 真实 token 进入 API，触发 Anthropic 的 `context_length_exceeded` 错误。
**改进方案**: 
1. 将 `estimateMessagesTokens()` 改为使用 `estimateTokens()` from `profile-context.ts`（已支持 CJK）
2. 对 structured content blocks（tool_use、tool_result），提取文本部分再调用 `estimateTokens()` 而非用 `JSON.stringify().length / 4`
3. 每次 `splice` 后使用 `estimateMessagesTokens(messages)` 重新计算（而非累减），避免误差放大
4. 添加中文对话场景的单元测试
**验收标准**: 
- 中文 20 轮 agentic 对话后不会触发 context_length_exceeded 错误
- `estimateMessagesTokens()` 对中文消息估算误差在 2x 以内
- 累减 vs 重算的差异 < 10%
- 测试覆盖：中文、英文、混合、structured content blocks
**影响范围**: packages/server/src/ai/agentic-chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
