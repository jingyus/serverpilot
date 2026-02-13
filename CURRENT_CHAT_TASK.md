### [pending] ExecutionLog AnsiOutput 对超长输出无虚拟化 — 500K 字符 ANSI 解析可能冻结 UI

**ID**: chat-095
**优先级**: P2
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `ExecutionLog.tsx` 中 `AnsiOutput` 组件（行 41-54）对步骤输出调用 `parseAnsi(text)` 并用 `useMemo` 缓存。`chat-execution.ts:35-43` 中 `appendOutput` 限制了单步输出上限为 500,000 字符（`MAX_OUTPUT_CHARS`）。对 500K 字符的文本进行 ANSI 解析和 DOM 渲染会：(1) `parseAnsi()` 正则解析 500K 文本可能耗时 100ms+ (2) 生成的 DOM 节点数可能达数万个 (3) 滚动性能极差。虽然大多数命令输出远小于此上限，但如 `find /` 或 `journalctl` 等命令确实可能产生大量输出。
**改进方案**: 对超过阈值（如 50K 字符）的输出只渲染尾部 N 行，顶部显示"输出已截断，共 X 行"的提示。或使用虚拟化文本渲染（如按行虚拟滚动）。
**验收标准**: (1) 500K 字符输出不冻结 UI (2) 用户可看到最新输出 (3) 显示截断提示
**影响范围**: `packages/dashboard/src/components/chat/ExecutionLog.tsx`
**创建时间**: 2026-02-13
**完成时间**: -

---
