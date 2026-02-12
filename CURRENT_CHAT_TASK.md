### [pending] Chat 建议点击功能缺失 — EmptyState 建议卡片无法触发发送消息

**ID**: chat-005
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**:
`Chat.tsx:363-379` 的 `EmptyState` 组件展示了 4 个建议卡片（"Install nginx and configure it"、"Check disk usage and clean up" 等），但这些卡片只有 `hover:bg-muted/50` 的悬浮效果和 `cursor-default` 样式，**点击没有任何响应**。

具体代码：
```tsx
// Chat.tsx:370-371
<Card
  key={suggestion}
  className="cursor-default transition-colors hover:bg-muted/50"  // cursor-default, no onClick!
>
```

对比 ChatGPT 和 Claude.ai，空状态的建议卡片点击后应该自动将建议文本填入输入框并发送。当前实现：
1. `EmptyState` 不接受 `onSend` 回调
2. 卡片没有 `onClick` 事件处理
3. `cursor-default` 暗示不可点击，但 `hover` 效果又暗示可交互——UX 矛盾

**改进方案**:
1. 给 `EmptyState` 添加 `onSuggestionClick: (text: string) => void` prop
2. 卡片改为 `cursor-pointer`，添加 `onClick={() => onSuggestionClick(suggestion)}`
3. 在 `Chat` 组件中将 `handleSend` 传入 `EmptyState`
4. 点击建议后直接发送消息（而非只填入输入框）

**验收标准**:
- 点击建议卡片触发 `sendMessage(suggestionText)`
- 卡片有 `cursor-pointer` 样式
- 添加 `data-testid="suggestion-card-{index}"` 便于测试
- Chat.test.tsx 新增测试：点击建议卡片后消息出现在消息列表中

**影响范围**:
- `packages/dashboard/src/pages/Chat.tsx` — EmptyState 组件修改
- `packages/dashboard/src/pages/Chat.test.tsx` — 新增测试

**创建时间**: 2026-02-12
**完成时间**: -

---
