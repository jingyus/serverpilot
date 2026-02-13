### [pending] ExecutionSummary duration 是静态快照 — 不显示实时计时器

**ID**: chat-099
**优先级**: P3
**模块路径**: packages/dashboard/src/components/chat/
**发现的问题**: `ExecutionLog.tsx` 中 `ExecutionSummary` 组件（约行 257）的 `totalDuration = startTime ? Date.now() - startTime : 0` 只在组件渲染时计算一次，不是实时更新的。用户在执行过程中看到的耗时数字是静态的（只有在有新渲染触发时才更新，比如收到新的步骤输出）。对于长时间运行的命令（如软件安装 5 分钟），显示的时间不变直到下一次渲染。
**改进方案**: 在执行期间（`isExecuting=true`）使用 `useEffect` + `setInterval` 每秒更新 duration 显示。执行完成后停止计时器并显示最终时间。
**验收标准**: (1) 执行中实时显示耗时 (2) 每秒更新一次 (3) 完成后显示最终耗时 (4) 计时器正确清理
**影响范围**: `packages/dashboard/src/components/chat/ExecutionLog.tsx`
**创建时间**: 2026-02-13
**完成时间**: -

---
