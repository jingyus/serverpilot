### [pending] MarkdownRenderer 复制按钮 Promise 未处理 + setTimeout 泄漏

**ID**: chat-016
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/MarkdownRenderer.tsx
**发现的问题**: 
1. `MarkdownRenderer.tsx:18` — `navigator.clipboard.writeText(code).then(...)` 无 `.catch()` 处理。非 HTTPS 环境、iframe 限制、或文档失焦时 Clipboard API 会 reject，产生 unhandled promise rejection
2. `MarkdownRenderer.tsx:20` — `setTimeout(() => setCopied(false), 2000)` 未在组件卸载时清理。如果用户在 2 秒内切换页面，会触发 "Can't perform a React state update on an unmounted component"
**改进方案**: 
1. 添加 `.catch(() => {})` 或使用 try/catch + async/await，失败时可选显示 fallback（如 "复制失败"）
2. 使用 `useEffect` 返回清理函数或 `useRef` 存储 timer ID，组件卸载时 `clearTimeout`
**验收标准**: 
- 非 HTTPS 环境下点击复制不产生控制台错误
- 快速切换页面不产生 React 卸载状态更新警告
- 现有 MarkdownRenderer 测试继续通过
**影响范围**: packages/dashboard/src/components/chat/MarkdownRenderer.tsx
**创建时间**: (自动填充)
**完成时间**: -

---
