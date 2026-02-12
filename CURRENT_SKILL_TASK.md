### [pending] TriggerManager — Cron/Event/Threshold 触发调度

**ID**: skill-006
**优先级**: P2
**模块路径**: packages/server/src/core/skill/
**当前状态**: 文件不存在 — `engine.ts:80-85` 中 `start()` 方法为空壳 (注释 "TriggerManager — deferred to future task")；当前仅支持手动执行
**实现方案**:

1. **trigger-manager.ts** (~350 行):
   - `TriggerManager` 类: 管理所有已启用 Skill 的自动触发器
   - **Cron 触发**: 使用 `node-cron` 库 (需新增依赖)
     - `registerCron(skillId, cronExpression, serverId)` — 注册 cron 定时任务
     - `unregisterCron(skillId)` — 停止并移除 cron 任务
     - cron 回调: `SkillEngine.execute(skillId, serverId, userId, 'cron')`
   - **Event 触发**: 订阅 WebhookDispatcher 事件
     - `registerEvent(skillId, eventTypes: string[])` — 监听 task.completed / alert.triggered / server.offline 等事件
     - 事件匹配时调用 `SkillEngine.execute()` with `triggerType='event'`
     - 通过 EventEmitter 或直接在 webhook dispatch 流程中注入 hook
   - **Threshold 触发**: 监听 MetricsBus 指标
     - `registerThreshold(skillId, metric, operator, value)` — 注册阈值监控
     - 订阅 `getMetricsBus()` 事件，当 cpu.usage > 90 等条件满足时触发
     - 防抖: 同一 Skill 同一 server 至少间隔 5 分钟才能再次触发
   - 生命周期:
     - `start()` — 从 DB 读取所有 enabled 的 Skill，注册各类触发器
     - `stop()` — 清除所有 cron 任务、取消事件订阅、停止阈值监控
     - `registerSkill(skill, manifest)` — 安装/启用时调用
     - `unregisterSkill(skillId)` — 卸载/暂停时调用
2. **更新 engine.ts**:
   - `start()` → 创建 TriggerManager 实例并调用 `triggerManager.start()`
   - `stop()` → 调用 `triggerManager.stop()`
   - `install()` → 若已 enabled 则 `triggerManager.registerSkill()`
   - `updateStatus('enabled')` → `triggerManager.registerSkill()`
   - `updateStatus('paused')` / `uninstall()` → `triggerManager.unregisterSkill()`
3. **trigger-manager.test.ts** (~300 行):
   - Cron: 注册 → 触发 → 执行回调验证
   - Event: 事件发布 → 匹配 → 触发执行验证
   - Threshold: 指标超限 → 触发 + 防抖逻辑验证
   - 生命周期: start 加载已有 Skill / stop 清理所有资源
   - 注册/反注册: Skill 状态变更正确更新触发器
4. **安装依赖**: `pnpm --filter @aiinstaller/server add node-cron && pnpm --filter @aiinstaller/server add -D @types/node-cron`

**验收标准**:
- Cron 表达式 (如 `0 8 * * *`) 能定时触发 Skill 执行
- Event 触发 (如 `alert.triggered`) 能自动执行对应 Skill
- Threshold 触发 (如 `cpu.usage > 90`) 能通过 MetricsBus 感知并触发
- 防抖机制防止同一 Skill 频繁触发 (≥5 分钟间隔)
- engine.ts 的 start/stop/install/updateStatus 正确集成 TriggerManager
- 测试 ≥ 20 个

**影响范围**:
- `packages/server/src/core/skill/trigger-manager.ts` (新建)
- `packages/server/src/core/skill/trigger-manager.test.ts` (新建)
- `packages/server/src/core/skill/engine.ts` (修改 — 集成 TriggerManager)
- `packages/server/package.json` (新增 node-cron 依赖)

**创建时间**: (自动填充)
**完成时间**: -

---
