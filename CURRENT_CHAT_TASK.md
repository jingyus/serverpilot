### [pending] scrollToBottom 在流式输出中每个 chunk 触发 — 造成滚动卡顿

**ID**: chat-014
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**: `Chat.tsx:93-95` 的 `useEffect` 依赖 `streamingContent` 变化触发 `scrollToBottom()`。流式输出时 `streamingContent` 每秒更新几十次（每个 SSE token chunk），每次都调用 `scrollIntoView({ behavior: 'smooth' })`。平滑滚动动画会堆叠，在长消息渲染时造成明显的视觉卡顿和 CPU 浪费。
**改进方案**: 
1. 流式输出中使用 `behavior: 'auto'`（瞬时滚动）而非 `'smooth'`
2. 或对 `scrollToBottom` 添加 `throttle`（如 100ms），避免高频触发
3. 仅在 `messages.length` 变化时使用 `'smooth'`（新消息到达），`streamingContent` 变化时使用 `'auto'`
**验收标准**: 
- 流式输出时页面滚动流畅无卡顿
- 新消息到达时仍有平滑滚动效果
- 长消息（>2000 字符）流式输出时 CPU 使用率明显降低
**影响范围**: packages/dashboard/src/pages/Chat.tsx
**创建时间**: (自动填充)
**完成时间**: -

---
