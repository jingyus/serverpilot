### [pending] 前端 ChatMessage 组件无消息复制和重新生成操作 — 对话交互体验远低于同类产品

**ID**: chat-069
**优先级**: P1
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `ChatMessage.tsx:35-93` 是纯展示组件，无任何交互功能。对比 ChatGPT/Claude.ai：(1) 无"复制消息"按钮——用户只能手动选择文本复制，assistant 消息含 Markdown 时选择困难；(2) 无"重新生成"按钮——AI 回复不满意时无法重试，必须重新输入相同问题；(3) 无消息 hover 操作栏——现代 AI Chat 产品都有消息 hover 时显示的操作按钮组。MarkdownRenderer（行 14-58）仅支持代码块复制，不支持整条消息复制。
**改进方案**:
1. 添加消息 hover 操作栏组件 `MessageActions`：
   - 复制按钮（assistant 消息：复制原始 markdown；user 消息：复制纯文本）
   - 重新生成按钮（仅 assistant 消息最后一条）
2. 操作栏样式：absolute 定位在消息右上角，hover 时显示
3. 复制使用 `navigator.clipboard.writeText()`，成功后显示 Toast 通知
4. 重新生成：调用 `chatStore.regenerateLastResponse()` → 删除最后一条 assistant 消息 → 重新发送最后一条 user 消息
**验收标准**:
- 消息 hover 时显示操作栏（包含复制和重新生成按钮）
- 点击复制后 Toast 提示"已复制"
- 重新生成删除旧回复并触发新的 AI 请求
- 移动端长按触发操作栏
- 添加 data-testid + 单元测试
**影响范围**:
- `packages/dashboard/src/components/chat/ChatMessage.tsx` — 添加操作栏
- `packages/dashboard/src/components/chat/ChatMessage.test.tsx` — 新增测试
- `packages/dashboard/src/stores/chat.ts` — 添加 `regenerateLastResponse` action
**创建时间**: 2026-02-13
**完成时间**: -

---
