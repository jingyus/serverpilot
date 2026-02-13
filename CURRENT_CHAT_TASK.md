### [pending] MessageInput 输入框每次按键触发 layout thrash — 长文本输入时可能卡顿

**ID**: chat-094
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `MessageInput.tsx` 中 textarea 自动调高逻辑（通过 `el.style.height = 'auto'` 然后 `el.style.height = el.scrollHeight + 'px'`）在每次 `onChange` 时执行，导致每次按键产生两次 layout/reflow：第一次设 auto 触发收缩计算，第二次设 scrollHeight 触发扩展计算。对于慢速设备或超长消息（接近 4000 字符限制），累积的 layout thrash 可能导致明显卡顿。
**改进方案**: 使用 `requestAnimationFrame` 合并高度调整，或用 CSS `field-sizing: content`（现代浏览器支持）替代 JS 计算。或者用 `ResizeObserver` 代替每次按键的高度重算。
**验收标准**: (1) 长文本输入无明显卡顿 (2) 自动调高功能保持正常 (3) 不影响现有测试
**影响范围**: `packages/dashboard/src/components/chat/MessageInput.tsx`
**创建时间**: 2026-02-13
**完成时间**: -

---
