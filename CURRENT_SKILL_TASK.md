### [pending] Pending Confirmation 过期自动清理定时器

**ID**: skill-062
**优先级**: P1
**模块路径**: packages/server/src/core/skill/engine.ts, packages/server/src/index.ts
**当前状态**: `expirePendingConfirmations()` 方法已实现但从未被定时调用。Pending confirmation 会无限积累，不会自动过期清理。
**实现方案**: 
1. 在 `SkillEngine.start()` 方法中添加 `setInterval` 定时器，每 10 分钟调用 `this.expirePendingConfirmations()`
2. 定时器句柄保存为 `private confirmationCleanupTimer: NodeJS.Timeout | null`
3. `stop()` 方法中 `clearInterval(this.confirmationCleanupTimer)`
4. 定时器使用 `.unref()` 避免阻止进程退出
5. 添加日志记录过期清理的数量
6. 添加对应测试 — 验证定时器启停和清理调用
**验收标准**: 
- `start()` 启动后自动每 10 分钟清理过期 pending confirmations
- `stop()` 正确清除定时器
- 清理结果有日志输出
- 至少 2 个测试验证定时器行为
**影响范围**: packages/server/src/core/skill/engine.ts, packages/server/src/core/skill/engine.test.ts
**创建时间**: (自动填充)
**完成时间**: -

---
