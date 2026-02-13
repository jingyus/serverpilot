### [pending] Agentic 确认超时 resolve(false) 与用户 confirm 请求的 TOCTOU 竞态 — 用户批准被忽略

**ID**: chat-080
**优先级**: P3
**模块路径**: packages/server/src/api/routes/
**发现的问题**: `chat.ts:192-198` 的确认超时回调和 `chat.ts:387-394` 的用户确认端点之间存在 TOCTOU（Time-of-Check-Time-of-Use）竞态：(1) 超时定时器触发（行 193），执行 `pendingConfirmations.delete(confirmId)` + `resolve(false)`；(2) 几乎同时，用户点击"批准"，confirm 端点检查 `pendingConfirmations.get(body.confirmId)`（行 387）；(3) 如果 delete 在 get 之前执行，用户收到 404 "No pending confirmation found"——但超时已 resolve(false) 导致命令被拒绝。由于 Promise 只 resolve 一次，如果 get 在 delete 之前执行（取到了 entry），clearTimeout 和 resolve(true) 都正常。但第一种时序下用户体验很差——刚好在超时边界点击批准被拒绝且收到错误。
**改进方案**:
1. 在 confirm 端点增加一个短暂的宽限期检查：如果 confirmId 不在 Map 中，检查是否在 1 秒内刚被超时清除（用一个 `recentlyExpired: Set<confirmId>` 追踪）
2. 如果是刚过期的确认，返回 `{ success: false, message: 'Confirmation expired', expired: true }` 而非 404
3. 前端根据 `expired: true` 显示"确认已超时"而非"未找到确认"
**验收标准**:
- 超时边界点击确认返回友好的过期提示（非 404）
- recentlyExpired 条目 10 秒后自动清理
- 正常流程不受影响
- 新增测试覆盖竞态场景
**影响范围**:
- `packages/server/src/api/routes/chat.ts` — confirm 端点 + recentlyExpired 追踪
- `packages/server/tests/api/routes/chat.test.ts` — 新增测试
**创建时间**: 2026-02-13
**完成时间**: -
