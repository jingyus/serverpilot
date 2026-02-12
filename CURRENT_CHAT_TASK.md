### [pending] SSE 连接组件卸载时未清理 — Chat 页面离开后 SSE 连接泄漏

**ID**: chat-006
**优先级**: P0
**模块路径**: packages/dashboard/src/pages/Chat.tsx, packages/dashboard/src/stores/chat.ts
**发现的问题**: `Chat.tsx` 组件无 `useEffect` 清理函数来关闭活跃的 SSE 连接。模块级 `activeHandle`（chat.ts:117）在用户导航离开 Chat 页面时不会被 abort。SSE 连接持续存在，回调继续更新已卸载组件的 Zustand state，造成内存泄漏和无效的状态更新。Chat.tsx:78-85 的 `useEffect` 没有 return cleanup 函数。
**改进方案**: 
1. 在 `chat.ts` store 中新增 `cleanup()` action，调用 `activeHandle?.abort(); activeHandle = null;` 并重置流式状态
2. 在 `Chat.tsx` 中添加 `useEffect(() => { return () => cleanup(); }, []);` 组件卸载清理
3. 确保 `cleanup()` 也清除 `isStreaming`、`streamingContent`、`isReconnecting` 状态
**验收标准**: 
- 用户在流式输出中离开 Chat 页面时，SSE 连接立即关闭
- 不再有 "state update on unmounted component" 场景
- 新增测试覆盖组件卸载时的清理行为
**影响范围**: packages/dashboard/src/pages/Chat.tsx, packages/dashboard/src/stores/chat.ts
**创建时间**: (自动填充)
**完成时间**: -

---
