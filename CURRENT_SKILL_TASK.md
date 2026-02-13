### [pending] Cron 触发熔断机制 — 防止失败 Skill 无限重试

**ID**: skill-091
**优先级**: P0
**模块路径**: packages/server/src/core/skill/
**当前状态**: trigger-manager.ts 对 cron 触发的 Skill 无失败跟踪。一个持续失败的 Skill 会每个 poll 周期 (60s) 不断重试，无退避、无熔断、无自动禁用。
**实现方案**: 
1. 在 `trigger-manager.ts` 添加 `failureCounters: Map<string, { consecutive: number; lastFailure: Date }>` 
2. 每次 cron 执行失败时递增 `consecutive`；成功时重置为 0
3. 当 `consecutive >= MAX_CONSECUTIVE_FAILURES` (默认 5) 时:
   - 调用 `getSkillRepository().updateStatus(skillId, 'error')` 自动暂停
   - 记录 warn 日志："Skill auto-paused after N consecutive failures"
   - 触发 `skill.auto_paused` webhook 事件通知用户
4. 添加 `resetFailureCounter(skillId)` 方法供手动恢复时调用
5. engine.ts 在 `updateStatus('enabled')` 时调用 `resetFailureCounter()`
**验收标准**: 
- 连续失败 5 次的 cron skill 自动进入 error 状态
- 成功执行后计数器归零
- 手动恢复后计数器归零
- 测试覆盖: ≥8 个测试用例
**影响范围**: packages/server/src/core/skill/trigger-manager.ts, packages/server/src/core/skill/trigger-manager.test.ts (或新建 trigger-manager-circuit-breaker.test.ts)
**创建时间**: 2026-02-13
**完成时间**: -

---
