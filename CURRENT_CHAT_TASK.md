### [pending] SessionSidebar 无会话重命名功能 — 只能依赖 lastMessage 预览识别会话

**ID**: chat-074
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `SessionSidebar.tsx:112-113` 显示 `session.lastMessage ?? t('chat.newSession')` 作为会话标题。用户无法重命名会话，只能通过最后一条消息的截断预览区分不同会话。当多个会话讨论类似主题时（如"安装 nginx"和"配置 nginx"），预览文本几乎相同，难以区分。对比 ChatGPT/Claude.ai 都支持会话重命名（双击标题或编辑图标）。`SessionItem` 接口（行 9-14）也无 `title` 字段。
**改进方案**:
1. 给 `SessionItem` 接口添加 `title?: string` 字段
2. 在 session 项添加"编辑"图标按钮（与删除按钮并列，hover 时显示）
3. 点击后切换为内联编辑模式（input 替换 p 标签）
4. Enter 确认，Escape 取消
5. 调用 `PATCH /chat/:serverId/sessions/:sessionId` API 更新标题
**验收标准**:
- 会话项 hover 显示编辑图标
- 点击进入内联编辑模式
- Enter 保存，Escape 取消
- 保存后标题持久化（刷新后仍显示）
- data-testid + 测试覆盖
**影响范围**:
- `packages/dashboard/src/components/chat/SessionSidebar.tsx` — 编辑 UI
- `packages/dashboard/src/stores/chat-sessions.ts` — renameSession action
- `packages/dashboard/src/components/chat/SessionSidebar.test.tsx` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
