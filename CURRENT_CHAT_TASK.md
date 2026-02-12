### [pending] ChatMessage 组件缺少 Markdown 渲染 — AI 回复丢失格式和代码高亮

**ID**: chat-003
**优先级**: P1
**模块路径**: packages/dashboard/src/components/chat/ChatMessage.tsx
**发现的问题**:
`ChatMessage.tsx:69` 使用纯 `<p className="whitespace-pre-wrap break-words">{message.content}</p>` 渲染消息内容。AI 回复通常包含大量 Markdown 格式（标题、列表、代码块、加粗等），全部以纯文本展示，严重影响可读性。

具体表现：
1. 代码块 (\`\`\`bash...\`\`\`) 没有语法高亮，没有复制按钮
2. 列表、标题、粗体等 Markdown 语法直接显示为原始字符
3. Agentic 模式中，streaming content（Chat.tsx:192）同样是 `<pre>` 纯文本
4. 对比 ChatGPT / Claude.ai，Markdown 渲染是 AI 聊天应用的基本要求

**改进方案**:
1. 安装 `react-markdown` + `remark-gfm`（GFM 表格/删除线支持）
2. 安装 `react-syntax-highlighter` 或使用 Shiki 进行代码高亮
3. 在 `ChatMessage.tsx` 中将 assistant 消息通过 `<ReactMarkdown>` 渲染
4. 为代码块添加复制按钮（Copy to clipboard）
5. 用户消息保持纯文本（用户输入通常不含 Markdown）
6. 流式内容（streaming）也需要支持 Markdown 实时渲染

**验收标准**:
- AI 回复中的代码块有语法高亮和复制按钮
- 标题、列表、粗体、链接正确渲染
- 流式输出过程中 Markdown 能逐步渲染（不等到完成）
- 不影响用户消息的展示
- ChatMessage.test.tsx 更新覆盖 Markdown 渲染场景

**影响范围**:
- `packages/dashboard/src/components/chat/ChatMessage.tsx` — 主要修改
- `packages/dashboard/src/pages/Chat.tsx` — streaming 内容的渲染
- `packages/dashboard/package.json` — 新增依赖
- `packages/dashboard/src/components/chat/ChatMessage.test.tsx` — 更新测试

**创建时间**: 2026-02-12
**完成时间**: -

---
