### [pending] SessionSidebar 在移动端完全隐藏且无替代入口 — 手机用户无法管理会话

**ID**: chat-070
**优先级**: P1
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `SessionSidebar.tsx:68` 使用 `hidden lg:block` 类名，在 `<1024px` 屏幕宽度下完全隐藏。移动端和平板用户完全无法：(1) 查看历史会话列表；(2) 切换到旧会话；(3) 删除会话。Chat.tsx 中也无任何替代入口（汉堡菜单、底部 sheet、侧滑手势）。这意味着移动端用户每次进入 Chat 页面只能使用新会话，无法访问任何历史对话。
**改进方案**:
1. 在 Chat header（`ChatHeader.tsx`）添加移动端"会话列表"按钮（仅在 `lg:` 以下显示）
2. 点击后展示 Drawer/Sheet 组件包裹 `SessionSidebar`
3. Drawer 从左侧滑入，背景半透明遮罩
4. 选择会话或点击遮罩后自动关闭 Drawer
5. 使用 `@headlessui/react` Dialog 或自定义 Drawer 组件
**验收标准**:
- 移动端显示"会话列表"图标按钮
- 点击后左侧 Drawer 展示完整 SessionSidebar
- 选择会话后 Drawer 自动关闭
- 遮罩点击关闭 Drawer
- 响应式：`lg:` 以上仍使用原有内联 sidebar
- 添加 data-testid + 测试
**影响范围**:
- `packages/dashboard/src/pages/Chat.tsx` — 添加 Drawer 逻辑
- `packages/dashboard/src/components/chat/ChatHeader.tsx` — 添加移动端按钮
- `packages/dashboard/src/pages/Chat.test.tsx` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
