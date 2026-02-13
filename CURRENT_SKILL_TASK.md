### [pending] Skill 执行历史自动清理 — 保留策略 + 定时清理

**ID**: skill-076
**优先级**: P1
**模块路径**: packages/server/src/core/skill/
**当前状态**: `skill_executions` 表记录无限增长，无清理机制。仅 pending confirmation 有 30 分钟 TTL。
**实现方案**: 
1. 在 `skill-repository.ts` 的 `SkillRepository` 接口添加:
   - `deleteExecutionsBefore(cutoff: Date): Promise<number>` — 按时间删除旧记录
   - `countExecutions(skillId?: string): Promise<number>` — 统计记录数
2. 在 `engine.ts` 的 `start()` 中启动清理定时器 (每 24 小时执行一次):
   - 默认保留策略: 保留最近 90 天的执行记录
   - 使用 `setInterval().unref()` 不阻塞进程退出
3. Drizzle + InMemory 两种实现
4. 对应测试
**验收标准**: 
- 超过 90 天的执行记录被自动清理
- 清理不影响运行中的执行
- 日志记录清理数量
- 测试覆盖: ≥8 个测试用例
**影响范围**: packages/server/src/db/repositories/skill-repository.ts, packages/server/src/core/skill/engine.ts, packages/server/src/db/repositories/skill-repository.test.ts
**创建时间**: 2026-02-13
**完成时间**: -

---
