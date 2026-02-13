### [pending] SessionSidebar 无历史会话搜索 — 会话多时无法快速定位目标对话

**ID**: chat-079
**优先级**: P3
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `SessionSidebar.tsx` 整个组件无搜索/过滤功能。会话列表按日期分组（today/yesterday/thisWeek/older），但当用户积累 50+ 会话后，只能逐个展开分组查找。每个 session 仅显示 `lastMessage` 截断预览（行 112-113），无法按消息内容、命令、服务器等维度搜索。对比 ChatGPT 和 Claude.ai 的侧边栏都有搜索框支持全文搜索。
**改进方案**:
1. 在 SessionSidebar 顶部（行 71 后）添加搜索输入框
2. 搜索逻辑：客户端过滤 `sessions` 数组，匹配 `lastMessage` 和 `title`（如果有）
3. 搜索使用 debounce（300ms）避免频繁过滤
4. 匹配结果高亮显示关键词
5. 无匹配时显示空状态提示
**验收标准**:
- 搜索框输入后实时过滤会话列表
- 支持中英文搜索
- 清空搜索恢复完整列表
- data-testid + 测试覆盖
**影响范围**:
- `packages/dashboard/src/components/chat/SessionSidebar.tsx` — 添加搜索 UI + 过滤逻辑
- `packages/dashboard/src/components/chat/SessionSidebar.test.tsx` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
