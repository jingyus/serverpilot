### [pending] MessageInput 无 Escape 取消流式和 Ctrl+K 搜索快捷键 — 键盘操作效率低

**ID**: chat-077
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `MessageInput.tsx:40-48` 仅处理 `Enter`/`Shift+Enter` 键盘事件。缺少：(1) `Escape` 键取消流式输出——当前必须用鼠标点击"停止"按钮（行 95-107），频繁使用 Chat 时效率低下；(2) 无任何全局快捷键支持。对比 Claude.ai：Escape 取消生成，`/` 聚焦输入框。当前 `onCancel` prop 已存在（行 13），只需在 keydown 事件中调用即可。
**改进方案**:
1. 在 `handleKeyDown` 中添加 `Escape` 处理：当 `isStreaming` 时调用 `onCancel()`
2. 添加全局 keydown listener（在 Chat.tsx 中）：
   - `Escape`：取消流式 / 关闭确认对话框
   - `/`：聚焦输入框（当前无焦点在输入框时）
3. 添加 `aria-keyshortcuts` 属性提升可访问性
**验收标准**:
- 按 Escape 可取消正在进行的流式输出
- 快捷键不与系统/浏览器快捷键冲突
- 添加 testid + 键盘事件测试
**影响范围**:
- `packages/dashboard/src/components/chat/MessageInput.tsx` — Escape 键处理
- `packages/dashboard/src/pages/Chat.tsx` — 全局快捷键 listener
- `packages/dashboard/src/components/chat/MessageInput.test.tsx` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -

---
