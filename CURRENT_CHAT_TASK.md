### [pending] SessionSidebar 日期分组使用硬编码英文 — 与项目 i18n 不一致

**ID**: chat-031
**优先级**: P2
**模块路径**: packages/dashboard/src/pages/Chat.tsx
**发现的问题**: `Chat.tsx:501-514` 的 `getSessionDateGroup()` 函数和 `Chat.tsx:547` 的 `groupOrder` 数组使用硬编码英文字符串 `'Today'`、`'Yesterday'`、`'This Week'`、`'Older'`。项目使用 `react-i18next` 做国际化，其他所有 UI 文本都通过 `t()` 函数获取。SessionSidebar 中这些分组标题直接在 `Chat.tsx:584` 渲染为英文文本，与中文 UI 的其他部分不一致。
**改进方案**: 
1. 将日期分组文本移入 i18n 翻译文件（`chat.sessionGroupToday`、`chat.sessionGroupYesterday` 等）
2. `getSessionDateGroup` 返回 key（如 `'today'`），渲染时通过 `t(`chat.sessionGroup.${key}`)` 转换
3. 或在 `SessionSidebar` 组件中使用 `useTranslation` 翻译分组标题
**验收标准**: 
- 日期分组标题根据当前语言显示（中文环境显示"今天"、"昨天"等）
- 所有现有 Chat 页面测试通过
**影响范围**: packages/dashboard/src/pages/Chat.tsx, 国际化翻译文件
**创建时间**: (自动填充)
**完成时间**: -

---
