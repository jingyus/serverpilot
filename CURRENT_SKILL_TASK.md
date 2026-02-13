### [pending] trigger-manager.ts 拆分 — 从 530 行降至 ≤500 行

**ID**: skill-099
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: trigger-manager.ts 当前 530 行，超过 500 行软限制。文件包含 cron 调度、event 匹配、threshold 评估、熔断器逻辑四种不同职责混合在一个文件中。
**实现方案**: 
1. 提取 threshold 评估逻辑 (`evaluateThreshold()`, `checkThresholdTrigger()`, debounce 管理) 到 `trigger-evaluators.ts` (~100 行)
2. trigger-manager.ts 保留: TriggerManager 类、cron 计算、event 匹配、熔断器、单例管理 (~430 行)
3. `trigger-evaluators.ts` 导出纯函数，TriggerManager 调用它们
**验收标准**: 
- trigger-manager.ts ≤ 500 行
- trigger-evaluators.ts ≤ 150 行
- 所有 trigger-manager 相关测试继续通过
- 新文件有对应单元测试 trigger-evaluators.test.ts (≥5 个测试)
**影响范围**: packages/server/src/core/skill/trigger-manager.ts (拆分), 新建 trigger-evaluators.ts, trigger-evaluators.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
